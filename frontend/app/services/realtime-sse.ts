import Service from '@ember/service';
import { registerDestructor } from '@ember/destroyable';
import { tracked } from '@glimmer/tracking';

export type SseCallback = (payload: unknown) => void;
export type Unsubscribe = () => void;

/**
 * RealtimeSseService
 *
 * Provides a simple pub-sub API over a SharedWorker that manages
 * a single SSE connection per browser (regardless of tab count).
 *
 * Server-side subscription filtering is handled entirely by the SharedWorker,
 * which tracks a global topic reference count across all ports and calls
 * POST/DELETE /api/sse/subscriptions when a topic goes from 0->1 or 1->0.
 *
 * Usage:
 *   const unsub = this.realtimeSse.subscribe('folder:123', (payload) => { ... });
 *   // call unsub() when done (e.g. registerDestructor)
 */
export default class RealtimeSseService extends Service {
  @tracked isConnected = false;
  @tracked isReconnecting = false;
  @tracked activeTopicCount = 0;

  private worker: SharedWorker | null = null;
  /** topic -> set of callbacks registered in this tab */
  private callbacks = new Map<string, Set<SseCallback>>();

  constructor(...args: ConstructorParameters<typeof Service>) {
    super(...args);
    this.initWorker();
    registerDestructor(this, () => this.teardown());
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  private initWorker() {
    if (typeof SharedWorker === 'undefined') {
      console.warn('[RealtimeSSE] SharedWorker is not supported in this environment');
      return;
    }

    try {
      this.worker = new SharedWorker('/sse-worker.js', {
        name: 'sse-library-worker',
        type: 'classic',
      });
      this.worker.port.onmessage = (e) => this.handleWorkerMessage(e);
      this.worker.port.onmessageerror = (e) =>
        console.error('[RealtimeSSE] Worker port message error:', e);
      this.worker.onerror = (e) =>
        console.error('[RealtimeSSE] Worker error:', e);
      this.worker.port.start();
    } catch (err) {
      console.error('[RealtimeSSE] Failed to create SharedWorker:', err);
    }
  }

  private teardown() {
    this.worker?.port.postMessage({ type: 'disconnect' });
    this.worker?.port.close();
    this.callbacks.clear();
  }

  // ---------------------------------------------------------------------------
  // Worker message handler
  // ---------------------------------------------------------------------------

  private handleWorkerMessage(event: MessageEvent) {
    const data = event.data as Record<string, unknown>;

    if (data['type'] === 'worker:ready') {
      // Worker is fresh or restarted - re-announce subscriptions so the worker
      // can restore its portRegistry and topicRefCount for this tab
      this.callbacks.forEach((_, topic) => {
        this.worker?.port.postMessage({ type: 'subscribe', topic });
      });
      return;
    }

    if (data['type'] === 'sse:connected') {
      this.isConnected = true;
      this.isReconnecting = false;
      return;
    }

    if (data['type'] === 'sse:reconnecting') {
      this.isConnected = false;
      this.isReconnecting = true;
      return;
    }

    // Routed topic event
    const topic = data['topic'] as string | undefined;
    const payload = data['payload'];
    if (topic) {
      const cbs = this.callbacks.get(topic);
      cbs?.forEach((cb) => {
        try {
          cb(payload);
        } catch (err) {
          console.error(`[RealtimeSSE] Callback error for topic "${topic}":`, err);
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to a topic. Returns an unsubscribe function.
   *
   * Multiple callbacks can be registered for the same topic. The SharedWorker
   * receives only ONE subscribe/unsubscribe per topic per tab and manages
   * server-side registration globally across all tabs.
   */
  subscribe(topic: string, callback: SseCallback): Unsubscribe {
    if (!this.callbacks.has(topic)) {
      this.callbacks.set(topic, new Set());
      this.activeTopicCount = this.callbacks.size;
      this.worker?.port.postMessage({ type: 'subscribe', topic });
    }
    this.callbacks.get(topic)!.add(callback);

    let called = false;
    return () => {
      if (called) return;
      called = true;
      this.removeCallback(topic, callback);
    };
  }

  private removeCallback(topic: string, callback: SseCallback) {
    const cbs = this.callbacks.get(topic);
    if (!cbs) return;
    cbs.delete(callback);
    if (cbs.size === 0) {
      this.callbacks.delete(topic);
      this.activeTopicCount = this.callbacks.size;
      this.worker?.port.postMessage({ type: 'unsubscribe', topic });
    }
  }

  /** Close the SSE connection - call on logout to stop the 401 retry loop */
  disconnect() {
    this.worker?.port.postMessage({ type: 'disconnect-sse' });
  }

  /** Establish SSE connection - call after user re-authenticates */
  connect() {
    this.worker?.port.postMessage({ type: 'connect-sse' });
  }
}

declare module '@ember/service' {
  interface Registry {
    'realtime-sse': RealtimeSseService;
  }
}
