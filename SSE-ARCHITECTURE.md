# SSE Architecture — SharedWorker Scenarios

This document describes how the SSE (Server-Sent Events) system works end-to-end and the
behaviour in every meaningful scenario a browser tab can encounter.

---

## Overview

```
┌─────────────────────────────────────────────────────────┐
│  Browser (one origin)                                   │
│                                                         │
│  ┌──────────────┐   port   ┌───────────────────────┐   │
│  │   Tab A      │◄────────►│                       │   │
│  │ RealtimeSSE  │          │   sse-worker.js        │   │
│  │   Service    │          │   (SharedWorker)       │──────► GET /api/sse/connect
│  └──────────────┘          │                       │   │    (one SSE connection)
│                            │   portRegistry Map    │   │
│  ┌──────────────┐   port   │   portId → { port,    │   │
│  │   Tab B      │◄────────►│             topics }  │   │
│  │ RealtimeSSE  │          │                       │   │
│  │   Service    │          └───────────────────────┘   │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

**Key property:** a single `EventSource` connection is shared across all tabs for the same
origin. This bypasses the browser's 6-connection-per-origin limit and avoids duplicate
server load.

---

## Message Protocol

### Tab → Worker

| Message | Meaning |
|---------|---------|
| `{ type: 'subscribe', topic }` | Register interest in a topic |
| `{ type: 'unsubscribe', topic }` | Deregister interest in a topic |
| `{ type: 'disconnect' }` | Tab is closing / navigating away |
| `{ type: 'reconnect-sse' }` | Force SSE reconnect (e.g. after re-login) |

### Worker → Tab

| Message | Meaning |
|---------|---------|
| `{ type: 'worker:ready', portId }` | Handshake complete — re-announce subscriptions |
| `{ type: 'sse:connected' }` | SSE link is up |
| `{ type: 'sse:reconnecting' }` | SSE link dropped, auto-reconnecting |
| `{ topic, payload }` | Routed event for a subscribed topic |

---

## Scenarios

### 1. First tab opens (no SharedWorker running)

```
Tab opens
  └─► new SharedWorker('/sse-worker.js')     # browser spawns worker process
        └─► onconnect fires
              ├─► portRegistry.set(portId=1, { port, topics: new Set() })
              ├─► connectSSE()               # EventSource created
              └─► port.postMessage({ type: 'worker:ready', portId: 1 })

Tab receives worker:ready
  └─► re-announces all active topic subscriptions (none yet at this point)

EventSource opens
  └─► worker broadcasts { type: 'sse:connected' } to all ports
        └─► Tab sets isConnected = true
```

The worker process is now alive. `portRegistry` has one entry. One SSE connection is open
to the backend.

---

### 2. Second tab opens (SharedWorker already running)

```
Tab opens
  └─► new SharedWorker('/sse-worker.js')     # browser reuses the existing process
        └─► onconnect fires (same worker, new port)
              ├─► portRegistry.set(portId=2, { port, topics: new Set() })
              ├─► connectSSE()               # no-op: EventSource already open
              └─► port.postMessage({ type: 'worker:ready', portId: 2 })

Tab receives worker:ready
  └─► re-announces all active topic subscriptions for this tab
```

No new SSE connection is created. The existing connection is reused. `portRegistry` now
has two entries.

---

### 3. How subscriptions work

Subscriptions are two-layered:

**Layer 1 — `RealtimeSseService` (per tab):**
Maintains a `Map<topic, Set<callback>>`. Multiple components in the same tab can register
callbacks for the same topic. The worker is notified only once per topic per tab (on the
first subscriber and on the last unsubscribe).

**Layer 2 — `sse-worker.js` (shared):**
Maintains a `Set<topic>` per port. When an SSE event arrives, it routes the raw payload
to every port that has subscribed to that topic.

```
Component A subscribes to "folder:123"
  └─► RealtimeSseService.subscribe("folder:123", cbA)
        ├─► callbacks.set("folder:123", Set{ cbA })
        └─► worker ← { type: 'subscribe', topic: 'folder:123' }
              └─► portRegistry[portId].topics.add("folder:123")

Component B (same tab) subscribes to "folder:123"
  └─► RealtimeSseService.subscribe("folder:123", cbB)
        ├─► callbacks.get("folder:123").add(cbB)   # Set{ cbA, cbB }
        └─► worker NOT notified (topic already registered for this port)

SSE event arrives: { topic: "folder:123", payload: { ... } }
  └─► worker routes to all ports subscribed to "folder:123"
        └─► Tab receives { topic, payload }
              └─► RealtimeSseService calls cbA(payload) and cbB(payload)
```

---

### 4. Unsubscribing from a topic

```
Component A unsubscribes
  └─► RealtimeSseService.removeCallback("folder:123", cbA)
        └─► callbacks["folder:123"] = Set{ cbB }   # cbB still there, no worker message

Component B unsubscribes (last callback for this topic)
  └─► RealtimeSseService.removeCallback("folder:123", cbB)
        ├─► callbacks.delete("folder:123")          # map entry removed
        └─► worker ← { type: 'unsubscribe', topic: 'folder:123' }
              └─► portRegistry[portId].topics.delete("folder:123")
```

Events for `folder:123` will no longer be delivered to this tab. Other tabs with their own
subscriptions to the same topic are unaffected.

In Ember, `registerDestructor` is used to call `unsubscribe()` automatically when a
component or route is destroyed (navigation away, component teardown).

---

### 5. Tab closes or navigates away

```
Tab unloads
  └─► RealtimeSseService.teardown()
        ├─► worker ← { type: 'disconnect' }
        │     └─► portRegistry.delete(portId)
        │           └─► if portRegistry.size === 0 → disconnectSSE()
        └─► worker.port.close()
```

If other tabs remain open, the SSE connection stays alive. If this was the last tab, the
SSE connection is closed and the worker process becomes idle (browser may terminate it).

---

### 6. SSE connection drops (network error / server restart)

```
EventSource encounters error (network drop, server restart, etc.)
  └─► eventSource.onerror fires
        ├─► worker broadcasts { type: 'sse:reconnecting' } to all ports
        │     └─► each Tab sets isConnected = false, isReconnecting = true
        └─► EventSource auto-reconnects (browser built-in behaviour)
              └─► on reconnect: eventSource.onopen fires
                    ├─► worker broadcasts { type: 'sse:connected' }
                    │     └─► each Tab sets isConnected = true, isReconnecting = false
                    └─► existing portRegistry subscriptions are preserved
                          (worker-side topic sets were never cleared)
```

No re-subscription messages are needed — topic sets in the worker's `portRegistry` survive
the SSE reconnect intact.

> **Note:** Events that fired on the server during the disconnection window are lost.
> The `EventSource` reconnect does not replay missed events unless the server implements
> `Last-Event-ID` support.

---

### 7. Forced reconnect after re-login

When the user logs out and back in, the SSE connection needs new credentials (session
cookie). The service exposes a `reconnect()` method for this:

```
User logs in again
  └─► RealtimeSseService.reconnect()
        └─► worker ← { type: 'reconnect-sse' }
              ├─► disconnectSSE()   # close old EventSource (stale credentials)
              └─► connectSSE()      # open new EventSource (new session cookie sent)
```

Topic subscriptions in `portRegistry` are preserved across this cycle, so events resume
without requiring components to re-subscribe.

---

### 8. All tabs close (worker termination) then a new tab opens

```
Last tab closes
  └─► portRegistry becomes empty → disconnectSSE()
  └─► browser terminates the SharedWorker process

New tab opens later
  └─► browser spawns a fresh SharedWorker process  (identical to Scenario 1)
        └─► onconnect fires, connectSSE(), worker:ready sent

Tab receives worker:ready
  └─► re-announces all currently active topic subscriptions
```

From the tab's code perspective this is indistinguishable from the first-ever tab load.
The key difference: if the backend was publishing events during the downtime window
(between last-tab-close and new-tab-open), those events were not received by any client.

---

### 9. Dead port detection

If a port throws on `postMessage` (tab crashed without sending `disconnect`), the worker
detects it during the next broadcast or route call:

```
routeToSubscribers / broadcastToAll
  └─► port.postMessage throws
        └─► portId added to dead[] list
              └─► removePort(portId) called after iteration
                    └─► portRegistry.delete(portId)
                          └─► if empty → disconnectSSE()
```

This ensures stale ports never accumulate in the registry.

---

## Backend: `SseEmitterService`

The Spring Boot backend maintains one `SseEmitter` per connected client (one SharedWorker
= one emitter per logged-in user). Key characteristics:

- **Emitter map:** `userId → List<SseEmitter>` — supports multiple devices per user.
- **Heartbeat:** every 25 seconds a comment event is sent to all emitters to keep
  proxies and load balancers from closing idle connections.
- **Dead emitter cleanup:** failed `send()` calls mark the emitter as dead and remove it
  from the map.
- **Publish API:** `publish(userId, topic, payload)` and
  `publishToUsers(userIds, topic, payload)` for broadcast to multiple users.

The SSE payload format is:

```json
{ "topic": "folder:123", "payload": { "action": "document-added", ... } }
```

---

## Worker Versioning

The SharedWorker file (`sse-worker.js`) is served at a fixed URL. Because the browser
reuses an existing worker process as long as any tab has it open, deploying a new version
does not immediately replace a running worker.

**Behaviour on deploy:**

- Existing tabs continue using the old worker until all tabs for the origin are closed.
- New tabs opening after a deploy may connect to the old worker if it is still alive.
- Once the last tab closes, the worker dies. The next tab to open gets the new version.

**Mitigation:** Include a `version` constant in the worker and send it in the
`worker:ready` message. The `RealtimeSseService` can compare it against the expected
version and reload the page if there is a mismatch — ensuring a freshly opened tab never
silently runs against a stale worker.
