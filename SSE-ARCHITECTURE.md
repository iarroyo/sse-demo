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

## Topics

A topic is an object `{ eventName, resourceId? }`, for example
`{ eventName: 'folder', resourceId: '123' }` or `{ eventName: 'notifications' }`. Topics
never contain a userId: the server resolves the user from the session and only publishes
to that user's emitters.

Because two objects with the same content are not equal in JavaScript, the service and the
worker index their maps by `topicKey(topic)`, a string such as `'["folder","123"]'`. The
key is internal; only the topic object goes over the wire. On the server, `Topic` is a Java
record, which compares by value.

In the diagrams below, `T` stands for `{ eventName: 'folder', resourceId: '123' }`.

---

## Message Protocol

### Tab → Worker

| Message | Meaning |
|---------|---------|
| `{ type: 'subscribe', topic: { eventName, resourceId } }` | Register interest in a topic |
| `{ type: 'unsubscribe', topic: { eventName, resourceId } }` | Deregister interest in a topic (ignored if this port never subscribed to it) |
| `{ type: 'register-lock', lockName }` | Name of the Web Lock this tab holds for its lifetime (see Scenario 9) |
| `{ type: 'disconnect' }` | Ember application is being torn down (rarely sent in normal use — not triggered by tab close or route transitions) |
| `{ type: 'disconnect-sse' }` | Close SSE connection without reconnecting (on logout, before the session is invalidated) |
| `{ type: 'connect-sse' }` | Establish SSE connection (e.g. after re-login) |

### Worker → Tab

| Message | Meaning |
|---------|---------|
| `{ type: 'worker:ready', portId }` | Handshake complete — re-announce subscriptions |
| `{ type: 'sse:connected' }` | SSE link is up |
| `{ type: 'sse:reconnecting' }` | SSE link dropped, auto-reconnecting |
| `{ eventName, resourceId, payload }` | Routed event for a subscribed topic |

The worker never forwards the `emitterId` to tabs; it owns all REST calls to the server.

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
  └─► re-announces all active topic subscriptions to worker (none yet at this point)

EventSource opens
  └─► eventSource.onopen fires   # transport is open — emitter:id not yet received

Server sends first SSE frame
  └─► eventSource.onmessage fires: { type: 'emitter:id', emitterId: 'abc-123' }
        ├─► worker stores currentEmitterId = 'abc-123'
        ├─► worker calls syncServerSubscriptions()
        │     # POSTs all topics in topicRefCount (none yet — no-op)
        └─► worker broadcasts { type: 'sse:connected' } to all ports
              └─► Tab sets isConnected = true
```

`sse:connected` is only broadcast after `emitter:id` is received — at that point the
connection is truly ready to use (server subscriptions can be registered). The worker
process is now alive. `portRegistry` has one entry. One SSE connection is open to the
backend. The server has registered the emitter and is ready to filter events by
subscription.

---

### 2. Second tab opens (SharedWorker already running)

```
Tab opens
  └─► new SharedWorker('/sse-worker.js')     # browser reuses the existing process
        └─► onconnect fires (same worker, new port)
              ├─► portRegistry.set(portId=2, { port, topics: new Set() })
              ├─► connectSSE()               # no-op: EventSource already open
              ├─► port.postMessage({ type: 'worker:ready', portId: 2 })
              └─► currentEmitterId is set → port.postMessage({ type: 'sse:connected' })
                    └─► Tab sets isConnected = true

Tab receives worker:ready
  └─► re-announces all active topic subscriptions to worker
        └─► worker calls incrementTopic() for each topic
              # if count goes 0→1: POST /api/sse/subscriptions X-Emitter-Id: abc-123
              # if count already ≥1: no-op (another tab already registered it)
```

No new SSE connection is created. The existing connection is reused. `portRegistry` now
has two entries. Because `currentEmitterId` is already known at `onconnect` time, the new
port receives `sse:connected` immediately — it does not need to wait for `onopen` or
`onmessage`. Server-side subscriptions are managed by the worker's `topicRefCount` — there
is no need for the tab to know the `emitterId`.

---

### 3. How subscriptions work

Subscriptions are three-layered:

**Layer 1 — `RealtimeSseService` (per tab):**
Maintains a `Map<topicKey, { topic, callbacks }>`. Multiple components in the same tab can
register callbacks for the same topic. The worker is notified only once per topic per tab
(on the first subscriber and on the last unsubscribe). The tab never calls the server
directly.

**Layer 2 — `sse-worker.js` (shared):**
Maintains a `Set<topicKey>` per port for routing and a global
`topicRefCount: Map<topicKey, { topic, count }>` across all ports. When an SSE event
arrives, it routes the payload to every port that has subscribed to that topic. The worker
calls the server REST API when a topic's count goes from 0 to 1 (POST) or from 1 to 0
(DELETE), ensuring the server is notified only once regardless of how many tabs are
listening.

**Layer 3 — Server (`SseEmitterService`):**
Maintains a `Set<Topic>` per emitter. `publish()` skips emitters that have not subscribed
to the topic, avoiding unnecessary SSE traffic when the user navigates away from a page.

```
Component A subscribes to T
  └─► RealtimeSseService.subscribe(T, cbA)
        ├─► callbacks.set('["folder","123"]', { topic: T, cbs: Set{ cbA } })
        └─► worker ← { type: 'subscribe', topic: T }
              ├─► portRegistry[portId].topics.add('["folder","123"]')
              └─► incrementTopic(T)
                    # count: 0→1 → POST /api/sse/subscriptions
                    #   X-Emitter-Id: abc-123  { "eventName": "folder", "resourceId": "123" }
                    #   server: emitterTopics["abc-123"].add(Topic[folder, 123])

Component B (same tab) subscribes to T
  └─► RealtimeSseService.subscribe(T, cbB)
        ├─► callbacks entry gets cbB              # cbs: Set{ cbA, cbB }
        └─► worker NOT notified (topic already registered for this tab)

SSE event arrives: { eventName: "folder", resourceId: "123", payload: { ... } }
  └─► worker routes to all ports subscribed to '["folder","123"]'
        └─► Tab receives { eventName, resourceId, payload }
              └─► RealtimeSseService calls cbA(payload) and cbB(payload)
```

---

### 4. Unsubscribing from a topic

```
Component A unsubscribes
  └─► RealtimeSseService.removeCallback('["folder","123"]', cbA)
        └─► cbs = Set{ cbB }                        # cbB still there, no worker message

Component B unsubscribes (last callback for this topic)
  └─► RealtimeSseService.removeCallback('["folder","123"]', cbB)
        ├─► callbacks.delete('["folder","123"]')    # map entry removed
        └─► worker ← { type: 'unsubscribe', topic: T }
              ├─► portRegistry[portId].topics.delete('["folder","123"]')
              └─► decrementTopic('["folder","123"]')
                    # count: 1→0 → DELETE /api/sse/subscriptions
                    #   X-Emitter-Id: abc-123  { "eventName": "folder", "resourceId": "123" }
                    #   server: emitterTopics["abc-123"].remove(Topic[folder, 123])
                    # if another tab still holds the topic (count ≥ 1) → no DELETE sent
```

Events for folder `123` will no longer be delivered to this tab. The server DELETE is only
sent when no other tab is still subscribed to the topic — if another tab is listening, the
server subscription remains active and that tab continues to receive events unaffected.

In Ember, `registerDestructor` is used to call `unsubscribe()` automatically when a
component is destroyed (e.g. removed from the DOM). The service itself is
application-scoped and is not destroyed on route transitions.

---

### 5. Tab closes or navigates away

There are two distinct paths depending on how the tab exits.

**Programmatic app teardown (`app.destroy()`, test teardown):**
`RealtimeSseService` is application-scoped — it survives route transitions and is only
destroyed when the Ember application itself is torn down. When that happens,
`registerDestructor` fires and runs `teardown()` explicitly:

```
Ember application destroyed
  └─► RealtimeSseService.teardown()
        ├─► worker ← { type: 'disconnect' }
        │     └─► portRegistry.delete(portId)
        │           └─► if portRegistry.size === 0 → disconnectSSE()
        ├─► worker.port.close()
        └─► release lifetime lock   # worker's lock callback: port already gone, no-op
```

In practice this path is rarely hit in a normal user session. Route transitions, navigating
to another page within the app, and closing the tab do not trigger it.

**Hard tab close, reload, external navigation, or crash:**
`teardown()` never executes and no `disconnect` message is sent.
`MessagePort.postMessage()` to a port whose tab is gone does not throw either, so the
worker can't notice by writing to it. Instead, the browser releases the tab's lifetime
Web Lock when its document is destroyed, which grants the request the worker queued for
that lock (see Scenario 9):

```
Tab closed by the user
  └─► (no disconnect message — teardown() is never called)
  └─► browser releases the tab's lifetime lock

If it was the last tab
  └─► browser terminates the SharedWorker → EventSource closed with it
        └─► server notices on its next write (heartbeat ≤ 25 s) → emitter cleaned up

If other tabs remain
  └─► worker's pending lock request is granted → removePort(portId)
        └─► decrementTopic() for each of its topics
              # topics no other tab holds → DELETE /api/sse/subscriptions
```

If other tabs remain open, the backend SSE connection is unaffected.

**Back/forward cache:** navigating away can put the page in the browser's back/forward
cache (BFCache) instead of destroying it. Its lock stays held, so its port and
subscriptions stay registered, and they are intact if the user comes back. If the worker
posts to a cached page, the browser evicts it from the cache, which releases the lock and
cleans up as above.

---

### 6. SSE connection drops (network error / server restart)

```
EventSource encounters error (network drop, server restart, etc.)
  └─► eventSource.onerror fires
        ├─► worker broadcasts { type: 'sse:reconnecting' } to all ports
        │     └─► each Tab sets isConnected = false, isReconnecting = true
        └─► EventSource auto-reconnects (browser built-in behaviour)
              └─► existing portRegistry subscriptions are preserved
                    (worker-side topic sets were never cleared)
```

`sse:connected` is **not** sent on `onopen`; it is sent once the new `emitter:id` arrives
(below).

> If the reconnect gets a non-200 response (for example a 401 because the session
> expired), the browser does not retry: the `EventSource` moves to `CLOSED` and stays
> there until `connect()` is called.

Worker-side topic sets in `portRegistry` and `topicRefCount` survive the SSE reconnect
intact — no re-subscription messages to the worker are needed.

The server, however, creates a **new emitter** on reconnect, so the old `emitterId` and
its topic set are gone. The server sends a fresh `emitter:id` event. The worker stores the
new `emitterId` and immediately re-registers all topics from `topicRefCount` with the
server — tabs are not involved.

```
EventSource reconnects
  └─► eventSource.onopen fires   # transport is open — emitter:id not yet received

Server sends first SSE frame on the new connection
  └─► eventSource.onmessage fires: { type: 'emitter:id', emitterId: 'xyz-456' }
        ├─► worker stores currentEmitterId = 'xyz-456'
        ├─► syncServerSubscriptions()
        │     # POSTs each topic in topicRefCount to the server
        │     POST /api/sse/subscriptions  X-Emitter-Id: xyz-456  { eventName, resourceId }
        └─► worker broadcasts { type: 'sse:connected' } to all ports
              └─► each Tab sets isConnected = true, isReconnecting = false
```

> **Note:** Events that fired on the server during the disconnection window are lost.
> The `EventSource` reconnect does not replay missed events unless the server implements
> `Last-Event-ID` support.

---

### 7. Logout and re-login (forced re-authentication)

Re-authentication is handled in two explicit steps.

**Step 1 — Logout: close SSE before the session is invalidated**

Logging out does not close the SSE stream on the server: the logout handler only
invalidates the session, and the emitter stays registered to the old user. If the
`EventSource` were left open, the logged-out browser would keep receiving that user's
events. (If the stream did drop afterwards, the reconnect would get a 401 and the browser
would stop retrying, leaving the `EventSource` closed.)

So `SessionService.logout()` calls `disconnect()` on the service *before* hitting the
logout endpoint:

```
User logs out
  └─► RealtimeSseService.disconnect()
        └─► worker ← { type: 'disconnect-sse' }
              ├─► currentEmitterId = null
              └─► disconnectSSE()   # EventSource closed cleanly, no auto-reconnect

  └─► POST /api/auth/logout         # session invalidated after SSE is already gone

Server notices the closed stream on its next write (heartbeat, ≤ 25 s)
  └─► emitter onError/onCompletion → emitter removed, emitterTopics entry deleted
```

**Step 2 — Re-login: open a fresh SSE connection**

After a successful login the browser stores the new session cookie. `SessionService.login()`
then calls `connect()` to open a new `EventSource`, which picks up the fresh cookie
automatically:

```
User logs in
  └─► POST /api/auth/login → Set-Cookie: JSESSIONID=<new>

  └─► RealtimeSseService.connect()
        └─► worker ← { type: 'connect-sse' }
              ├─► currentEmitterId = null
              ├─► disconnectSSE()   # no-op: already closed at logout
              └─► connectSSE()      # new EventSource opened with fresh session cookie
                    └─► eventSource.onopen fires   # transport open, not yet ready

                    Server sends first SSE frame
                    └─► eventSource.onmessage fires: { type: 'emitter:id', emitterId: 'xyz-456' }
                          ├─► worker stores currentEmitterId = 'xyz-456'
                          ├─► syncServerSubscriptions()
                          │     # re-POSTs all topics in topicRefCount
                          │     POST /api/sse/subscriptions  X-Emitter-Id: xyz-456
                          └─► worker broadcasts { type: 'sse:connected' } to all ports
                                └─► Tab sets isConnected = true
```

Worker-side topic sets in `portRegistry` and `topicRefCount` are untouched across both
steps. Server-side subscriptions are restored automatically when the new `emitter:id`
arrives — tabs are not involved.

---

### 8. All tabs close (worker termination) then a new tab opens

```
Last tab closes
  └─► browser terminates the SharedWorker process (EventSource closed with it)
        # no disconnect message is involved — see Scenario 5

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

`MessagePort` gives no signal when the other side goes away: `postMessage` to a closed,
reloaded or crashed tab's port silently does nothing, and the proposed `close` event was
removed from the HTML spec without shipping. The worker uses Web Locks instead, because
the browser releases a document's locks when the document is destroyed.

```
RealtimeSseService (on start)
  └─► navigator.locks.request('sse-tab-<uuid>', () => never-settling promise)
        └─► once GRANTED: worker ← { type: 'register-lock', lockName }
              └─► worker: navigator.locks.request(lockName, ...)   # queued behind the tab

Tab document destroyed (close, reload, navigation, crash)
  └─► browser releases the tab's lock
        └─► worker's request is granted
              └─► removePort(portId)        # skipped if the port is already gone
                    ├─► decrementTopic() for each of its topics
                    │     # count 1→0 → DELETE /api/sse/subscriptions
                    ├─► portRegistry.delete(portId)
                    └─► if empty → disconnectSSE()
```

The tab only sends `register-lock` **after** its own request is granted. If it sent the
name first, the worker's request could reach the lock manager first, be granted right
away, and make the worker drop a live tab.

On explicit teardown the service sends `disconnect` and then releases its lock. The
worker's lock callback finds the port already removed and does nothing.

If Web Locks are unavailable (they require a secure context: `https` or `localhost`), the
service logs a warning and closed tabs are not detected.

`routeToSubscribers` and `broadcastToAll` also wrap `port.postMessage` in `try/catch` and
remove any port that throws:

```
routeToSubscribers / broadcastToAll
  └─► port.postMessage throws
        └─► portId added to dead[] list
              └─► removePort(portId) called after iteration
                    ├─► for each topicKey in portRegistry[portId].topics:
                    │     decrementTopic(topicKey)
                    │       # count 1→0 → DELETE /api/sse/subscriptions
                    ├─► portRegistry.delete(portId)
                    └─► if empty → disconnectSSE()
```

This only catches messages that can't be serialized; it does not detect closed tabs.

---

## Backend

### `SseEmitterService`

Maintains one `SseEmitter` per connected browser (one SharedWorker = one emitter). Key
characteristics:

- **Emitter map:** `userId → List<SseEmitter>` — supports multiple devices/browsers per user.
- **Emitter identity:** each emitter is assigned a UUID (`emitterId`) on creation. It is
  sent to the client as the first SSE event: `{ type: "emitter:id", emitterId: "..." }`.
- **Subscription map:** `emitterId → Set<Topic>` — tracks which topics each emitter has
  registered interest in. `publish()` skips emitters that have not subscribed to the topic.
- **Heartbeat:** every 25 seconds a `:heartbeat` comment is sent to all emitters to keep
  proxies and load balancers from closing idle connections.
- **Dead emitter cleanup:** failed `send()` calls remove the emitter and its subscription
  set from all maps.
- **Publish API:** `publish(userId, Topic, payload)` and
  `publishToUsers(userIds, Topic, payload)`, with `Topic.folder(id)` and
  `Topic.NOTIFICATIONS` for the topics in use.

Every SSE event uses the event name `message`, and its data is:

```json
{ "eventName": "folder", "resourceId": "123", "payload": { "type": "DOCUMENT_CREATED", ... } }
```

For `notifications`, `resourceId` is `null`.

### `SseSubscriptionController`

Exposes two endpoints for managing server-side topic subscriptions. Both require
authentication and the `X-Emitter-Id` header identifying the SSE connection. A missing or
blank `eventName` returns 400.

| Method | Path | Body | Effect |
|--------|------|------|--------|
| `POST` | `/api/sse/subscriptions` | `{ "eventName": "folder", "resourceId": "123" }` | Add topic to emitter's subscription set |
| `DELETE` | `/api/sse/subscriptions` | `{ "eventName": "folder", "resourceId": "123" }` | Remove topic from emitter's subscription set |

---

## Worker Versioning

The SharedWorker file (`sse-worker.js`) is served at a fixed URL. Because the browser
reuses an existing worker process as long as any tab has it open, deploying a new version
does not immediately replace a running worker.

**Behaviour on deploy:**

- Existing tabs continue using the old worker until all tabs for the origin are closed.
- New tabs opening after a deploy may connect to the old worker if it is still alive.
- Once the last tab closes, the worker dies. The next tab to open gets the new version.

**Mitigation (not implemented yet):** Include a `version` constant in the worker and send it in the
`worker:ready` message. The `RealtimeSseService` can compare it against the expected
version and reload the page if there is a mismatch — ensuring a freshly opened tab never
silently runs against a stale worker.
