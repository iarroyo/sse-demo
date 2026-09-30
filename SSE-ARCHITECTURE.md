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
| `{ type: 'disconnect-sse' }` | Close SSE connection without reconnecting (on logout) |
| `{ type: 'connect-sse' }` | Establish SSE connection (e.g. after re-login) |

### Worker → Tab

| Message | Meaning |
|---------|---------|
| `{ type: 'worker:ready', portId, emitterId }` | Handshake complete — re-announce subscriptions (`emitterId` is `null` if SSE not yet connected) |
| `{ type: 'sse:connected' }` | SSE link is up |
| `{ type: 'sse:reconnecting' }` | SSE link dropped, auto-reconnecting |
| `{ type: 'emitter:id', emitterId }` | Server-assigned ID for this SSE connection |
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
              └─► port.postMessage({ type: 'worker:ready', portId: 1, emitterId: null })

Tab receives worker:ready (emitterId is null — SSE not yet connected)
  └─► re-announces all active topic subscriptions to worker (none yet at this point)

EventSource opens
  ├─► server sends first event: { type: 'emitter:id', emitterId: 'abc-123' }
  │     └─► worker stores currentEmitterId = 'abc-123'
  │           └─► worker broadcasts { type: 'emitter:id', emitterId: 'abc-123' } to all ports
  │                 └─► Tab stores emitterId, POSTs all active topics to server
  │                       POST /api/sse/subscriptions  X-Emitter-Id: abc-123
  └─► worker broadcasts { type: 'sse:connected' } to all ports
        └─► Tab sets isConnected = true
```

The worker process is now alive. `portRegistry` has one entry. One SSE connection is open
to the backend. The server has registered the emitter and is ready to filter events by
subscription.

---

### 2. Second tab opens (SharedWorker already running)

```
Tab opens
  └─► new SharedWorker('/sse-worker.js')     # browser reuses the existing process
        └─► onconnect fires (same worker, new port)
              ├─► portRegistry.set(portId=2, { port, topics: new Set() })
              ├─► connectSSE()               # no-op: EventSource already open
              └─► port.postMessage({ type: 'worker:ready', portId: 2, emitterId: 'abc-123' })

Tab receives worker:ready (emitterId is present — SSE already connected)
  ├─► re-announces all active topic subscriptions to worker
  └─► stores emitterId and POSTs all active topics to server
        POST /api/sse/subscriptions  X-Emitter-Id: abc-123
```

No new SSE connection is created. The existing connection is reused. `portRegistry` now
has two entries. No new `emitter:id` event arrives — the worker passes the stored one
directly in `worker:ready`.

---

### 3. How subscriptions work

Subscriptions are three-layered:

**Layer 1 — `RealtimeSseService` (per tab):**
Maintains a `Map<topic, Set<callback>>`. Multiple components in the same tab can register
callbacks for the same topic. The worker and server are each notified only once per topic
per tab (on the first subscriber and on the last unsubscribe).

**Layer 2 — `sse-worker.js` (shared):**
Maintains a `Set<topic>` per port. When an SSE event arrives, it routes the raw payload
to every port that has subscribed to that topic.

**Layer 3 — Server (`SseEmitterService`):**
Maintains a `Set<topic>` per emitter. `publish()` skips emitters that have not subscribed
to the topic, avoiding unnecessary SSE traffic when the user navigates away from a page.

```
Component A subscribes to "folder:123"
  └─► RealtimeSseService.subscribe("folder:123", cbA)
        ├─► callbacks.set("folder:123", Set{ cbA })
        ├─► worker ← { type: 'subscribe', topic: 'folder:123' }
        │     └─► portRegistry[portId].topics.add("folder:123")
        └─► POST /api/sse/subscriptions  X-Emitter-Id: abc-123  { topic: "folder:123" }
              └─► server: emitterTopics["abc-123"].add("folder:123")

Component B (same tab) subscribes to "folder:123"
  └─► RealtimeSseService.subscribe("folder:123", cbB)
        ├─► callbacks.get("folder:123").add(cbB)   # Set{ cbA, cbB }
        └─► worker and server NOT notified (topic already registered for this tab)

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
        └─► callbacks["folder:123"] = Set{ cbB }   # cbB still there, no worker/server message

Component B unsubscribes (last callback for this topic)
  └─► RealtimeSseService.removeCallback("folder:123", cbB)
        ├─► callbacks.delete("folder:123")          # map entry removed
        ├─► worker ← { type: 'unsubscribe', topic: 'folder:123' }
        │     └─► portRegistry[portId].topics.delete("folder:123")
        └─► DELETE /api/sse/subscriptions  X-Emitter-Id: abc-123  { topic: "folder:123" }
              └─► server: emitterTopics["abc-123"].delete("folder:123")
```

Events for `folder:123` will no longer be delivered to this tab, and the server will stop
publishing them to this emitter entirely. Other tabs/browsers with their own subscriptions
to the same topic are unaffected.

In Ember, `registerDestructor` is used to call `unsubscribe()` automatically when a
component or route is destroyed (navigation away, component teardown).

---

### 5. Tab closes or navigates away

There are two distinct paths depending on how the tab exits.

**In-app navigation (Ember route teardown):**
Ember destroys services and components as part of the route lifecycle. `registerDestructor`
fires, which runs `teardown()` explicitly:

```
Ember app / service destroyed
  └─► RealtimeSseService.teardown()
        ├─► worker ← { type: 'disconnect' }
        │     └─► portRegistry.delete(portId)
        │           └─► if portRegistry.size === 0 → disconnectSSE()
        └─► worker.port.close()
```

**Hard tab close or browser kill (Ctrl+W, crash, process termination):**
The JavaScript context is destroyed by the browser with no opportunity to run code.
`teardown()` never executes and no `disconnect` message is ever sent. The worker only
discovers the port is gone the next time it attempts to write to it — either on the next
incoming SSE event or on the next heartbeat broadcast. This is the dead port detection
path (see Scenario 9).

```
Tab killed by browser
  └─► (no JS runs — teardown() is never called)

Next SSE event or heartbeat
  └─► worker tries port.postMessage(...)
        └─► throws → port added to dead[] → removePort(portId)
              └─► if portRegistry.size === 0 → disconnectSSE()
```

In both cases, if other tabs remain open the backend SSE connection is unaffected. If this
was the last tab, the connection is closed once the dead port is detected.

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

Worker-side topic sets in `portRegistry` survive the SSE reconnect intact — no
re-subscription messages to the worker are needed.

The server, however, creates a **new emitter** on reconnect, so the old `emitterId` and
its topic set are gone. The server sends a fresh `emitter:id` event, which the worker
broadcasts to all ports. Each tab receives it, stores the new `emitterId`, and re-POSTs
all active topics to the server.

```
EventSource reconnects
  └─► server creates new emitter → sends { type: 'emitter:id', emitterId: 'xyz-456' }
        └─► worker stores currentEmitterId = 'xyz-456', broadcasts to all ports
              └─► each Tab: stores new emitterId, POSTs all active topics
                    POST /api/sse/subscriptions  X-Emitter-Id: xyz-456
```

> **Note:** Events that fired on the server during the disconnection window are lost.
> The `EventSource` reconnect does not replay missed events unless the server implements
> `Last-Event-ID` support.

---

### 7. Logout and re-login (forced re-authentication)

Re-authentication is handled in two explicit steps to avoid a 401 retry loop.

**Step 1 — Logout: close SSE before the session is invalidated**

If the `EventSource` is left open when the backend invalidates the session, it will
trigger `onerror` and immediately try to reconnect — but with the now-invalid cookie,
every reconnect attempt gets a 401. The worker keeps broadcasting `sse:reconnecting` to
all ports in a tight retry loop until something stops it.

To prevent this, `SessionService.logout()` calls `disconnect()` on the service *before*
hitting the logout endpoint:

```
User logs out
  └─► RealtimeSseService.disconnect()
        ├─► emitterId = null         # clear stale emitter ID
        └─► worker ← { type: 'disconnect-sse' }
              ├─► currentEmitterId = null
              └─► disconnectSSE()   # EventSource closed cleanly, no auto-reconnect

  └─► POST /api/auth/logout         # session invalidated after SSE is already gone
        └─► server cleanup: emitter removed, emitterTopics entry deleted
```

**Step 2 — Re-login: open a fresh SSE connection**

After a successful login the new session cookie is set by the browser. `connect()` is
called to open a new `EventSource`, which picks up the fresh cookie automatically:

```
User logs in
  └─► POST /api/auth/login → Set-Cookie: SESSION=<new>

  └─► RealtimeSseService.connect()
        └─► worker ← { type: 'connect-sse' }
              ├─► currentEmitterId = null
              ├─► disconnectSSE()   # no-op: already closed at logout
              └─► connectSSE()      # new EventSource opened with fresh session cookie
                    └─► server sends { type: 'emitter:id', emitterId: 'xyz-456' }
                          └─► worker broadcasts to all ports
                                └─► each Tab: stores new emitterId, re-POSTs active topics
                                      POST /api/sse/subscriptions  X-Emitter-Id: xyz-456
```

Worker-side topic sets in `portRegistry` are untouched across both steps. Server-side
subscriptions are restored automatically when the new `emitter:id` arrives.

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

## Backend

### `SseEmitterService`

Maintains one `SseEmitter` per connected browser (one SharedWorker = one emitter). Key
characteristics:

- **Emitter map:** `userId → List<SseEmitter>` — supports multiple devices/browsers per user.
- **Emitter identity:** each emitter is assigned a UUID (`emitterId`) on creation. It is
  sent to the client as the first SSE event: `{ type: "emitter:id", emitterId: "..." }`.
- **Subscription map:** `emitterId → Set<topic>` — tracks which topics each emitter has
  registered interest in. `publish()` skips emitters that have not subscribed to the topic.
- **Heartbeat:** every 25 seconds a comment event is sent to all emitters to keep
  proxies and load balancers from closing idle connections.
- **Dead emitter cleanup:** failed `send()` calls remove the emitter and its subscription
  set from all maps.
- **Publish API:** `publish(userId, topic, payload)` and
  `publishToUsers(userIds, topic, payload)`.

The SSE payload format is:

```json
{ "topic": "folder:123", "payload": { "action": "document-added", ... } }
```

### `SseSubscriptionController`

Exposes two endpoints for managing server-side topic subscriptions. Both require
authentication and the `X-Emitter-Id` header identifying the SSE connection.

| Method | Path | Body | Effect |
|--------|------|------|--------|
| `POST` | `/api/sse/subscriptions` | `{ "topic": "folder:123" }` | Add topic to emitter's subscription set |
| `DELETE` | `/api/sse/subscriptions` | `{ "topic": "folder:123" }` | Remove topic from emitter's subscription set |

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
