# SSE Sequence Diagrams

Visual representation of all lifecycle scenarios. See `EVENTS-GUIDE.md` for detailed
written descriptions.

`T` stands for the topic `{ eventName: "folder", resourceId: "123" }`. Maps in the
service and the worker are indexed by its `topicKey`, `'["folder","123"]'`.

---

## 1. First Tab - Connection & Emitter ID

No SharedWorker exists yet. The browser spawns a fresh process, opens the SSE connection,
and the server assigns an emitter ID.

```mermaid
sequenceDiagram
    participant Tab
    participant Worker as SharedWorker
    participant Server as BFF

    Tab->>Worker: new SharedWorker()
    Worker->>Worker: portRegistry.set(portId=1, topics=∅)
    Worker->>Server: GET /api/sse/connect (EventSource)
    Worker-->>Tab: worker:ready { portId: 1 }
    Note over Tab: No subscriptions to announce yet

    Note over Worker: eventSource.onopen fires (transport open, not yet ready)

    Note over Worker: eventSource.onmessage fires
    Server-->>Worker: SSE: { type: "emitter:id", emitterId: "abc-123" }
    Worker->>Worker: currentEmitterId = "abc-123"
    Worker->>Worker: syncServerSubscriptions() - no-op (topicRefCount empty)
    Worker-->>Tab: { type: "sse:connected" }
    Tab->>Tab: isConnected = true
```

---

## 2. Second Tab - Reusing the Existing Worker

The SharedWorker is already running. No new SSE connection is created. `sse:connected`
is sent directly to the new port because `currentEmitterId` is already set.

```mermaid
sequenceDiagram
    participant TabA as Tab A (existing)
    participant Worker as SharedWorker
    participant TabB as Tab B (new)
    participant Server as BFF

    Note over Worker: SSE already open, currentEmitterId = "abc-123"

    TabB->>Worker: new SharedWorker() (process reused)
    Worker->>Worker: portRegistry.set(portId=2, topics=∅)
    Note over Worker: connectSSE() is a no-op
    Worker-->>TabB: worker:ready { portId: 2 }
    Note over Worker: currentEmitterId set - send connected directly
    Worker-->>TabB: { type: "sse:connected" }
    TabB->>TabB: isConnected = true

    TabB->>Worker: { type: "subscribe", topic: T }
    Worker->>Worker: portRegistry[portId=2].topics.add(topicKey(T))
    Worker->>Worker: incrementTopic(T) - count 0 to 1
    Worker->>Server: POST /api/sse/subscriptions { eventName: "folder", resourceId: "123" }<br/>X-Emitter-Id: abc-123
    Note over Server: emitterTopics["abc-123"].add(Topic[folder, 123])
```

---

## 3. Subscription & Event Delivery

How a component subscribes and receives a routed event end-to-end.

```mermaid
sequenceDiagram
    participant Comp as Component
    participant Service as RealtimeSseService
    participant Worker as SharedWorker
    participant Server as BFF

    Comp->>Service: subscribe(T, callback)
    Note over Service: First subscriber for this topic in this tab
    Service->>Worker: { type: "subscribe", topic: T }
    Worker->>Worker: portRegistry[portId].topics.add(topicKey(T))
    Worker->>Worker: incrementTopic(T) - count 0 to 1
    Worker->>Server: POST /api/sse/subscriptions { eventName: "folder", resourceId: "123" }<br/>X-Emitter-Id: abc-123
    Note over Server: emitterTopics["abc-123"].add(Topic[folder, 123])

    Note over Server: Another user creates a document in folder 123
    Server-->>Worker: SSE: { eventName: "folder", resourceId: "123", payload: { ... } }
    Worker->>Worker: routeToSubscribers(T)
    Worker-->>Service: { eventName: "folder", resourceId: "123", payload: { ... } }
    Service->>Comp: callback(payload)
```

---

## 4. Unsubscribing From a Topic

The last component for a topic unsubscribes. The worker notifies the server only if no other tab is still subscribed.

```mermaid
sequenceDiagram
    participant CompA as Component A
    participant CompB as Component B
    participant Service as RealtimeSseService
    participant Worker as SharedWorker
    participant Server as BFF

    CompA->>Service: unsubscribe() [callback A]
    Note over Service: topic T still has callback B - no worker message

    CompB->>Service: unsubscribe() [callback B - last subscriber]
    Service->>Worker: { type: "unsubscribe", topic: T }
    Worker->>Worker: portRegistry[portId].topics.delete(topicKey(T))
    Worker->>Worker: decrementTopic(topicKey(T)) - count 1 to 0
    Worker->>Server: DELETE /api/sse/subscriptions { eventName: "folder", resourceId: "123" }<br/>X-Emitter-Id: abc-123
    Note over Server: emitterTopics["abc-123"].remove(Topic[folder, 123])<br/>Server skips this topic on future publishes
```

---

## 5. Graceful App Teardown

The Ember application is explicitly destroyed (e.g. `app.destroy()` or test teardown).
Component destructors fire first, unsubscribing all topics before the service destructor
sends `disconnect`. In-app route transitions do not trigger this path — the service is
application-scoped and stays alive for the entire session.

```mermaid
sequenceDiagram
    participant Service as RealtimeSseService
    participant Worker as SharedWorker
    participant Server as BFF

    Note over Service: app.destroy() or test teardown<br/>(component destructors have already unsubscribed all topics)
    Service->>Worker: { type: "disconnect" }
    Worker->>Worker: portRegistry.delete(portId)

    alt Last tab
        Worker->>Worker: disconnectSSE() - EventSource closed, worker becomes idle
        Note over Server: Next heartbeat write fails (≤ 25 s)<br/>emitter removed, topic set deleted
    else Other tabs still open
        Note over Worker: SSE connection unaffected
    end
```

---

## 6. SSE Connection Drop & Reconnect

Network error or server restart. `EventSource` auto-reconnects, a new emitter is created,
and topics are re-registered with the server.

```mermaid
sequenceDiagram
    participant Tab
    participant Worker as SharedWorker
    participant Server as BFF

    Server-xWorker: SSE connection drops (network / server restart)
    Worker->>Worker: eventSource.onerror fires
    Worker-->>Tab: { type: "sse:reconnecting" }
    Tab->>Tab: isConnected = false, isReconnecting = true

    Worker->>Server: GET /api/sse/connect (EventSource auto-reconnect)
    Note over Server: New emitter created<br/>old emitter + topic set discarded

    Note over Worker: eventSource.onopen fires (transport open, not yet ready)

    Note over Worker: eventSource.onmessage fires
    Server-->>Worker: SSE: { type: "emitter:id", emitterId: "xyz-456" }
    Worker->>Worker: currentEmitterId = "xyz-456"
    Worker->>Worker: syncServerSubscriptions()
    Worker->>Server: POST /api/sse/subscriptions per topic in topicRefCount<br/>X-Emitter-Id: xyz-456
    Worker-->>Tab: { type: "sse:connected" }
    Tab->>Tab: isConnected = true, isReconnecting = false
```

---

## 7. Logout & Re-login

SSE is closed before session invalidation, because logout does not close the stream on the
server and it would keep delivering the old user's events. A new emitter is assigned after
successful re-authentication.

```mermaid
sequenceDiagram
    participant Tab
    participant Worker as SharedWorker
    participant Server as BFF

    Note over Tab: User clicks logout
    Tab->>Worker: { type: "disconnect-sse" }
    Worker->>Worker: currentEmitterId = null
    Worker->>Worker: disconnectSSE() - EventSource closed, no auto-reconnect

    Tab->>Server: POST /api/auth/logout
    Note over Server: Session invalidated
    Note over Server: Next heartbeat write fails (≤ 25 s)<br/>emitter removed, topic set deleted

    Note over Tab: User fills in credentials and logs in
    Tab->>Server: POST /api/auth/login
    Server-->>Tab: 200 OK + Set-Cookie: JSESSIONID=<new>

    Tab->>Worker: { type: "connect-sse" }
    Worker->>Server: GET /api/sse/connect (new EventSource, fresh cookie)

    Note over Worker: eventSource.onopen fires (transport open, not yet ready)

    Note over Worker: eventSource.onmessage fires
    Server-->>Worker: SSE: { type: "emitter:id", emitterId: "xyz-456" }
    Worker->>Worker: currentEmitterId = "xyz-456"
    Worker->>Worker: syncServerSubscriptions()
    Worker->>Server: POST /api/sse/subscriptions per topic in topicRefCount<br/>X-Emitter-Id: xyz-456
    Worker-->>Tab: { type: "sse:connected" }
    Tab->>Tab: isConnected = true
```

---

## 8. Total Downtime & Fresh Restart

All tabs are closed so the browser terminates the SharedWorker. When the user returns and
opens a new tab, the system performs a full cold start identical to Diagram 1. Any events
published by the server during the downtime window are permanently lost.

```mermaid
sequenceDiagram
    participant Tab
    participant Worker as SharedWorker
    participant Server as BFF

    Note over Tab,Worker: Last tab closed - browser terminates the SharedWorker
    Worker--xServer: EventSource closed with the worker
    Note over Server: Next heartbeat write fails (≤ 25 s)<br/>emitter removed, topic set deleted

    Note over Tab: User returns and opens a new tab
    Tab->>Worker: new SharedWorker() (fresh process spawned)
    Note over Tab,Server: Cold start - identical to Diagram 1<br/>Events published during downtime are permanently lost
```

---

## 9. Hard Tab Close - Lifetime Lock

The tab is closed with no `disconnect` message, and posting to its port would not throw.
The worker learns about it from the tab's Web Lock instead (see Scenario 9 in
`EVENTS-GUIDE.md`).

```mermaid
sequenceDiagram
    participant Tab
    participant Locks as Lock manager (browser)
    participant Worker as SharedWorker
    participant Server as BFF

    Tab->>Locks: request("sse-tab-uuid") - held forever
    Locks-->>Tab: granted
    Tab->>Worker: { type: "register-lock", lockName: "sse-tab-uuid" }
    Worker->>Locks: request("sse-tab-uuid") - queued behind the tab

    Note over Tab: Tab closed (Ctrl+W, reload, crash)<br/>disconnect never sent
    Locks->>Locks: document destroyed - tab's lock released

    alt Last tab closed
        Note over Worker: Browser terminates the SharedWorker
        Worker--xServer: EventSource closed with the worker
        Note over Server: Next heartbeat write fails (≤ 25 s)<br/>emitter removed, topic set deleted
    else Other tabs still open
        Locks-->>Worker: granted
        Worker->>Worker: removePort(portId) - decrementTopic() per topic
        Worker->>Server: DELETE /api/sse/subscriptions<br/>for topics no other tab holds
    end
```
