import Service from '@ember/service';
import { registerDestructor } from '@ember/destroyable';
import { tracked } from '@glimmer/tracking';

export type SseCallback = (payload: unknown) => void;
export type Unsubscribe = () => void;

/**
 * SSE topic. The recipient user is resolved server-side from the session,
 * so topics never carry a userId.
 */
export interface SseTopic {
  eventName: string;
  resourceId?: string | null;
}

/** Stable string key for a topic (objects compare by reference in Maps). */
function topicKey({ eventName, resourceId }: SseTopic): string {
  return JSON.stringify([eventName, resourceId || null]);
}

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
 *   const unsub = this.realtimeSse.subscribe(
 *     { eventName: 'folder', resourceId: '123' },
 *     (payload) => { ... },
 *   );
 *   // call unsub() when done (e.g. registerDestructor)
 */
export default class RealtimeSseService extends Service {
  @tracked isConnected = false;
  @tracked isReconnecting = false;

  private worker: SharedWorker | null = null;
  /** Releases this tab's lifetime lock (see holdLifetimeLock) */
  private releaseLifetimeLock: (() => void) | null = null;
  private isTornDown = false;
  /** topicKey -> topic and the callbacks registered for it in this tab */
  private callbacks = new Map<string, { topic: SseTopic; cbs: Set<SseCallback> }>();

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
      this.holdLifetimeLock();
    } catch (err) {
      console.error('[RealtimeSSE] Failed to create SharedWorker:', err);
    }
  }

  /**
   * Hold a Web Lock for as long as this document lives and tell the worker its name.
   *
   * MessagePort gives the worker no signal when a tab closes, reloads or crashes
   * (postMessage to a dead port silently does nothing). The browser does release
   * a document's locks when it is destroyed, so the worker waits on this lock to
   * learn that the tab is gone and drop its port and subscriptions.
   *
   * The name is only sent once the lock is granted: if the worker's request reached
   * the lock manager first, it would be granted immediately and the worker would
   * wrongly treat this tab as closed.
   */
  private holdLifetimeLock() {
    if (!navigator.locks) {
      console.warn('[RealtimeSSE] Web Locks unavailable - closed tabs will not be detected');
      return;
    }

    const lockName = `sse-tab-${crypto.randomUUID()}`;
    void navigator.locks.request(lockName, () => {
      if (this.isTornDown) return;
      this.worker?.port.postMessage({ type: 'register-lock', lockName });
      return new Promise<void>((resolve) => {
        this.releaseLifetimeLock = resolve;
      });
    });
  }

  private teardown() {
    this.isTornDown = true;
    this.worker?.port.postMessage({ type: 'disconnect' });
    this.worker?.port.close();
    this.releaseLifetimeLock?.();
    this.releaseLifetimeLock = null;
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
      this.callbacks.forEach(({ topic }) => {
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
    const eventName = data['eventName'] as string | undefined;
    const resourceId = data['resourceId'] as string | null | undefined;
    const payload = data['payload'];
    if (eventName) {
      const key = topicKey({ eventName, resourceId });
      this.callbacks.get(key)?.cbs.forEach((cb) => {
        try {
          cb(payload);
        } catch (err) {
          console.error(`[RealtimeSSE] Callback error for topic ${key}:`, err);
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
  subscribe(topic: SseTopic, callback: SseCallback): Unsubscribe {
    const key = topicKey(topic);
    let entry = this.callbacks.get(key);
    if (!entry) {
      entry = {
        topic: { eventName: topic.eventName, resourceId: topic.resourceId },
        cbs: new Set(),
      };
      this.callbacks.set(key, entry);
      this.worker?.port.postMessage({ type: 'subscribe', topic: entry.topic });
    }
    entry.cbs.add(callback);

    let called = false;
    return () => {
      if (called) return;
      called = true;
      this.removeCallback(key, callback);
    };
  }

  private removeCallback(key: string, callback: SseCallback) {
    const entry = this.callbacks.get(key);
    if (!entry) return;
    entry.cbs.delete(callback);
    if (entry.cbs.size === 0) {
      this.callbacks.delete(key);
      this.worker?.port.postMessage({
        type: 'unsubscribe',
        topic: entry.topic,
      });
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
