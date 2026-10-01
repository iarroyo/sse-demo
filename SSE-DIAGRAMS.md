# SSE Sequence Diagrams

Visual representation of all lifecycle scenarios. See `SSE-ARCHITECTURE.md` for detailed
written descriptions.

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
    Worker-->>Tab: worker:ready { portId: 1, emitterId: null }
    Note over Tab: No subscriptions to announce yet

    Server-->>Worker: SSE: { type: "emitter:id", emitterId: "abc-123" }
    Worker->>Worker: currentEmitterId = "abc-123"
    Worker-->>Tab: { type: "emitter:id", emitterId: "abc-123" }
    Tab->>Tab: store emitterId = "abc-123"

    Worker-->>Tab: { type: "sse:connected" }
    Tab->>Tab: isConnected = true
```

---

## 2. Second Tab - Reusing the Existing Worker

The SharedWorker is already running. No new SSE connection is created. The stored
`emitterId` is passed directly in `worker:ready`.

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

    TabB->>Worker: { type: "subscribe", topic: "folder:123" }
    Worker->>Worker: portRegistry[portId=2].topics.add("folder:123")
    Worker->>Worker: incrementTopic("folder:123") - topicRefCount 0 to 1
    Worker->>Server: POST /api/sse/subscriptions { topic: "folder:123" }<br/>X-Emitter-Id: abc-123
    Note over Server: emitterTopics["abc-123"].add("folder:123")
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

    Comp->>Service: subscribe("folder:123", callback)
    Note over Service: First subscriber for this topic in this tab
    Service->>Worker: { type: "subscribe", topic: "folder:123" }
    Worker->>Worker: portRegistry[portId].topics.add("folder:123")
    Worker->>Worker: incrementTopic("folder:123") - topicRefCount 0 to 1
    Worker->>Server: POST /api/sse/subscriptions { topic: "folder:123" }<br/>X-Emitter-Id: abc-123
    Note over Server: emitterTopics["abc-123"].add("folder:123")

    Note over Server: Another user creates a document in folder:123
    Server-->>Worker: SSE: { topic: "folder:123", payload: { ... } }
    Worker->>Worker: routeToSubscribers("folder:123")
    Worker-->>Service: { topic: "folder:123", payload: { ... } }
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
    Note over Service: callbacks["folder:123"] still has B - no worker message

    CompB->>Service: unsubscribe() [callback B - last subscriber]
    Service->>Worker: { type: "unsubscribe", topic: "folder:123" }
    Worker->>Worker: portRegistry[portId].topics.delete("folder:123")
    Worker->>Worker: decrementTopic("folder:123") - topicRefCount 1 to 0
    Worker->>Server: DELETE /api/sse/subscriptions { topic: "folder:123" }<br/>X-Emitter-Id: abc-123
    Note over Server: emitterTopics["abc-123"].delete("folder:123")<br/>Server skips this topic on future publishes
```

---

## 5. SSE Connection Drop & Reconnect

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
    Server-->>Worker: SSE: { type: "emitter:id", emitterId: "xyz-456" }
    Worker->>Worker: currentEmitterId = "xyz-456"
    Worker->>Worker: syncServerSubscriptions()
    Worker->>Server: POST /api/sse/subscriptions per topic in topicRefCount<br/>X-Emitter-Id: xyz-456

    Worker-->>Tab: { type: "sse:connected" }
    Tab->>Tab: isConnected = true, isReconnecting = false
```

---

## 6. Logout & Re-login

SSE is closed before session invalidation to prevent a 401 retry loop. A new emitter is
assigned after successful re-authentication.

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
    Note over Server: Session invalidated<br/>emitter removed, topic set deleted

    Note over Tab: User fills in credentials and logs in
    Tab->>Server: POST /api/auth/login
    Server-->>Tab: 200 OK + Set-Cookie: SESSION=<new>

    Tab->>Worker: { type: "connect-sse" }
    Worker->>Server: GET /api/sse/connect (new EventSource, fresh cookie)
    Server-->>Worker: SSE: { type: "emitter:id", emitterId: "xyz-456" }
    Worker->>Worker: currentEmitterId = "xyz-456"
    Worker->>Worker: syncServerSubscriptions()
    Worker->>Server: POST /api/sse/subscriptions per topic in topicRefCount<br/>X-Emitter-Id: xyz-456

    Worker-->>Tab: { type: "sse:connected" }
    Tab->>Tab: isConnected = true
```

---

## 7. Hard Tab Close - Dead Port Detection

The tab is killed with no opportunity to run code. The worker discovers the dead port
passively on the next write attempt.

```mermaid
sequenceDiagram
    participant Tab
    participant Worker as SharedWorker
    participant Server as BFF

    Note over Tab: Tab killed (Ctrl+W, crash, process termination)<br/>No JS runs - disconnect never sent

    Note over Worker: portRegistry still holds the dead port

    Server-->>Worker: SSE event or heartbeat
    Worker->>Tab: port.postMessage(...) throws
    Worker->>Worker: dead.push(portId)
    Worker->>Worker: removePort(portId) - portRegistry.delete(portId)

    alt Last port removed
        Worker->>Worker: disconnectSSE()
        Worker->>Server: SSE connection closed
    else Other ports still active
        Note over Worker: SSE connection stays open
    end
```
