/**
 * SSE Shared Worker
 *
 * Central SSE connection shared across all browser tabs.
 * Bypasses the 6-connection-per-origin browser limit.
 *
 * A topic is { eventName: string, resourceId?: string }, e.g.
 * { eventName: 'folder', resourceId: '123' } or { eventName: 'notifications' }.
 * The recipient user is resolved server-side from the session.
 *
 * Port message protocol:
 *   { type: 'subscribe',   topic: Topic }        → register interest in a topic
 *   { type: 'unsubscribe', topic: Topic }        → deregister interest
 *   { type: 'disconnect' }                       → port is closing (Ember app teardown)
 *   { type: 'disconnect-sse' }                   → close SSE connection (on logout)
 *   { type: 'connect-sse' }                      → establish SSE connection (after re-login)
 *
 * Worker → port messages:
 *   { type: 'worker:ready', portId: number }     → handshake complete
 *   { type: 'sse:connected' }                    → SSE link up
 *   { type: 'sse:reconnecting' }                 → SSE link dropped, auto-reconnecting
 *   { eventName, resourceId, payload }           → event routed to subscriber
 */

/** @typedef {{ eventName: string, resourceId?: string | null }} Topic */

/** Stable string key for a topic, used to index Maps/Sets (objects compare by reference).
 *  @param {Topic} topic */
function topicKey({ eventName, resourceId }) {
  return JSON.stringify([eventName, resourceId || null]);
}

/** Port topics are stored by topicKey.
 *  @type {Map<number, { port: MessagePort, topics: Set<string> }>} */
const portRegistry = new Map();
let portCounter = 0;

/** @type {EventSource | null} */
let eventSource = null;

/** @type {string | null} */
let currentEmitterId = null;

/** Global topic reference count across all ports, by topicKey — used to sync with the server.
 *  @type {Map<string, { topic: Topic, count: number }>} */
const topicRefCount = new Map();

// ---------------------------------------------------------------------------
// SSE lifecycle
// ---------------------------------------------------------------------------

function connectSSE() {
  if (eventSource && eventSource.readyState !== EventSource.CLOSED) return;

  eventSource = new EventSource('/api/sse/connect', { withCredentials: true });

  eventSource.onopen = () => {
    console.debug('[SSEWorker] SSE transport open — waiting for emitter:id');
  };

  eventSource.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'emitter:id') {
        currentEmitterId = message.emitterId;
        console.debug('[SSEWorker] Emitter ID received:', currentEmitterId);
        syncServerSubscriptions();
        broadcastToAll({ type: 'sse:connected' });
        return;
      }
      if (message.eventName && message.payload !== undefined) {
        routeToSubscribers(message, message.payload);
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
// Server subscription sync
// ---------------------------------------------------------------------------

function serverSubscribe(topic) {
  if (!currentEmitterId) return;
  const { eventName, resourceId } = topic;
  fetch('/api/sse/subscriptions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Emitter-Id': currentEmitterId,
    },
    body: JSON.stringify({ eventName, resourceId }),
    credentials: 'include',
  }).catch((err) =>
    console.error(`[SSEWorker] Failed to subscribe topic ${topicKey(topic)}:`, err),
  );
}

function serverUnsubscribe(topic) {
  if (!currentEmitterId) return;
  const { eventName, resourceId } = topic;
  fetch('/api/sse/subscriptions', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'X-Emitter-Id': currentEmitterId,
    },
    body: JSON.stringify({ eventName, resourceId }),
    credentials: 'include',
  }).catch((err) =>
    console.error(`[SSEWorker] Failed to unsubscribe topic ${topicKey(topic)}:`, err),
  );
}

/** @param {Topic} topic */
function incrementTopic(topic) {
  const key = topicKey(topic);
  const entry = topicRefCount.get(key) ?? { topic, count: 0 };
  entry.count += 1;
  topicRefCount.set(key, entry);
  if (entry.count === 1) {
    serverSubscribe(topic);
  }
}

/** @param {string} key */
function decrementTopic(key) {
  const entry = topicRefCount.get(key);
  if (!entry) return;
  entry.count -= 1;
  if (entry.count <= 0) {
    topicRefCount.delete(key);
    serverUnsubscribe(entry.topic);
  }
}

/** Re-register all currently active topics with a freshly assigned emitter. */
function syncServerSubscriptions() {
  for (const { topic } of topicRefCount.values()) {
    serverSubscribe(topic);
  }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** @param {Topic} topic */
function routeToSubscribers(topic, payload) {
  const key = topicKey(topic);
  const { eventName, resourceId } = topic;
  const dead = [];
  for (const [portId, { port, topics }] of portRegistry) {
    if (topics.has(key)) {
      try {
        port.postMessage({ eventName, resourceId, payload });
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
  const entry = portRegistry.get(portId);
  if (entry) {
    for (const key of entry.topics) {
      decrementTopic(key);
    }
  }
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

    const key = topic?.eventName ? topicKey(topic) : null;

    switch (type) {
      case 'subscribe':
        if (key && !entry.topics.has(key)) {
          entry.topics.add(key);
          incrementTopic(topic);
          console.debug(`[SSEWorker] Port ${portId} subscribed to ${key}`);
        }
        break;

      case 'unsubscribe':
        if (key && entry.topics.has(key)) {
          entry.topics.delete(key);
          decrementTopic(key);
          console.debug(`[SSEWorker] Port ${portId} unsubscribed from ${key}`);
        }
        break;

      case 'disconnect':
        removePort(portId);
        break;

      case 'disconnect-sse':
        currentEmitterId = null;
        disconnectSSE();
        break;

      case 'connect-sse':
        currentEmitterId = null;
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

  // SSE already fully established — notify this port directly
  if (currentEmitterId) {
    port.postMessage({ type: 'sse:connected' });
  }
};
