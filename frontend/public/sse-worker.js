/**
 * SSE Shared Worker
 *
 * Central SSE connection shared across all browser tabs.
 * Bypasses the 6-connection-per-origin browser limit.
 *
 * Port message protocol:
 *   { type: 'subscribe',   topic: string }       → register interest in a topic
 *   { type: 'unsubscribe', topic: string }       → deregister interest
 *   { type: 'disconnect' }                       → port is closing (tab navigation/close)
 *   { type: 'reconnect-sse' }                    → force SSE reconnect (after re-login)
 *
 * Worker → port messages:
 *   { type: 'worker:ready', portId: number }     → handshake complete
 *   { type: 'sse:connected' }                    → SSE link up
 *   { type: 'sse:reconnecting' }                 → SSE link dropped, auto-reconnecting
 *   { topic: string, payload: object }           → event routed to subscriber
 */

/** @type {Map<number, { port: MessagePort, topics: Set<string> }>} */
const portRegistry = new Map();
let portCounter = 0;

/** @type {EventSource | null} */
let eventSource = null;

// ---------------------------------------------------------------------------
// SSE lifecycle
// ---------------------------------------------------------------------------

function connectSSE() {
  if (eventSource && eventSource.readyState !== EventSource.CLOSED) return;

  eventSource = new EventSource('/api/sse/connect', { withCredentials: true });

  eventSource.onopen = () => {
    console.debug('[SSEWorker] SSE connected');
    broadcastToAll({ type: 'sse:connected' });
  };

  eventSource.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.topic && message.payload !== undefined) {
        routeToSubscribers(message.topic, message.payload);
      }
    } catch (err) {
      console.error('[SSEWorker] Failed to parse SSE event:', err, event.data);
    }
  };

  eventSource.onerror = () => {
    console.warn('[SSEWorker] SSE error/disconnect – EventSource will auto-reconnect');
    broadcastToAll({ type: 'sse:reconnecting' });
  };
}

function disconnectSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
    console.debug('[SSEWorker] SSE disconnected');
  }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function routeToSubscribers(topic, payload) {
  const dead = [];
  for (const [portId, { port, topics }] of portRegistry) {
    if (topics.has(topic)) {
      try {
        port.postMessage({ topic, payload });
      } catch {
        dead.push(portId);
      }
    }
  }
  dead.forEach(removePort);
}

function broadcastToAll(message) {
  const dead = [];
  for (const [portId, { port }] of portRegistry) {
    try {
      port.postMessage(message);
    } catch {
      dead.push(portId);
    }
  }
  dead.forEach(removePort);
}

function removePort(portId) {
  portRegistry.delete(portId);
  console.debug(`[SSEWorker] Port ${portId} removed. Active ports: ${portRegistry.size}`);
  if (portRegistry.size === 0) {
    disconnectSSE();
  }
}

// ---------------------------------------------------------------------------
// Port connection handler
// ---------------------------------------------------------------------------

self.onconnect = (connectEvent) => {
  const port = connectEvent.ports[0];
  const portId = ++portCounter;

  portRegistry.set(portId, { port, topics: new Set() });
  console.debug(`[SSEWorker] Port ${portId} connected. Active ports: ${portRegistry.size}`);

  // Ensure SSE is running
  connectSSE();

  port.onmessage = (event) => {
    const { type, topic } = event.data ?? {};
    const entry = portRegistry.get(portId);
    if (!entry) return;

    switch (type) {
      case 'subscribe':
        if (topic) {
          entry.topics.add(topic);
          console.debug(`[SSEWorker] Port ${portId} subscribed to "${topic}"`);
        }
        break;

      case 'unsubscribe':
        if (topic) {
          entry.topics.delete(topic);
          console.debug(`[SSEWorker] Port ${portId} unsubscribed from "${topic}"`);
        }
        break;

      case 'disconnect':
        removePort(portId);
        break;

      case 'reconnect-sse':
        disconnectSSE();
        connectSSE();
        break;

      default:
        console.warn('[SSEWorker] Unknown message type:', type);
    }
  };

  port.onmessageerror = () => {
    console.warn(`[SSEWorker] Message error on port ${portId}, removing`);
    removePort(portId);
  };

  port.start();
  port.postMessage({ type: 'worker:ready', portId });
};
