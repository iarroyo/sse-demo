# Server-Sent Events (SSE) Architecture: SharedWorker Guide

## Introduction & System Overview

This document outlines the end-to-end architecture of our Server-Sent Events (SSE) system. It details how browser tabs interact with our backend and defines system behavior across all major operational scenarios.

To optimize performance, the architecture relies on a SharedWorker (sse-worker.js) that acts as a centralized hub inside the browser. Instead of every open tab establishing its own independent connection to the server, all tabs from the same origin share a single EventSource connection. This design pattern successfully bypasses the standard browser limitation of six concurrent connections per origin and significantly reduces unnecessary server load.

## Communication Protocol

The tabs and the SharedWorker communicate via a structured messaging protocol:

### From Tab to Worker

- **Subscribe:** Registers a tab's interest in a specific topic.
- **Unsubscribe:** Deregisters interest from a topic.
- **Disconnect:** Notifies the worker that a port is going away. This is only sent during in-app Ember navigation, when the framework explicitly destroys the service. It is never sent on a hard tab close or external navigation — in those cases the JavaScript context is killed immediately and the worker discovers the dead port passively on the next write attempt.
- **Disconnect SSE:** Closes the SSE connection without reconnecting, used on logout to prevent a 401 retry loop.
- **Connect SSE:** Establishes a fresh SSE connection, typically used after a user re-authenticates.

### From Worker to Tab

- **Worker Ready:** Sent when the initial handshake completes, prompting the tab to re-announce its active subscriptions. Includes the current `emitterId` if the SSE connection is already open, or `null` if it is still being established.
- **SSE Connected:** Confirms the backend SSE link is successfully established.
- **SSE Reconnecting:** Warns tabs that the network link dropped and the system is attempting to reconnect.
- **Emitter ID:** Delivers the server-assigned identifier for the current SSE connection. The tab uses this ID to register and deregister topic subscriptions with the server via REST.
- **Event Route:** Delivers the raw event payload directly to the tabs subscribed to that specific topic.

## Technical Scenarios and Lifecycle Behaviors

**1\. Opening the First Tab**

When a user opens the first tab of the application, no SharedWorker is running yet.

1. The browser spawns a fresh SharedWorker process, which triggers its internal connection logic.
2. The worker registers the new tab's communication port into an internal map (portRegistry) and spins up the main EventSource connection to the backend.
3. The worker sends a worker:ready handshake back to the tab with `emitterId: null` because the SSE connection is not yet established.
4. Once the backend connection opens, the server sends an emitter:id event containing a UUID that identifies this specific SSE connection. The worker stores it and forwards it to all ports.
5. The tab receives the emitter:id, stores it locally, and POSTs all its active topic subscriptions to the server using that ID as a header.
6. The worker also broadcasts an sse:connected message, prompting the tab to toggle its internal connection status to active.

**2\. Opening Subsequent Tabs**

When additional tabs are opened under the same origin, the browser recognizes that a SharedWorker is already active and reuses the existing process.

1. The worker registers the new tab's port alongside the existing ones, but it skips creating a new EventSource connection because the network link is already open.
2. The worker sends a worker:ready signal exclusively to the new tab, including the stored `emitterId` since the SSE connection is already established.
3. The new tab responds by announcing its active topic subscriptions to the worker and immediately POSTing them to the server using the received emitter ID. No new emitter:id event is needed.

**3\. Subscription Management**

The system processes subscriptions using a three-layer approach:

- **App layer (RealtimeSseService):** Manages a map of callbacks for each topic. Multiple UI components within the _same_ tab can listen to the exact same topic. The worker and server are only notified when the very first component subscribes to a topic, or when the final component unsubscribes.
- **Shared Worker layer (sse-worker.js):** Tracks a set of subscribed topics for every open port. When an event arrives from the server, the worker iterates through its registry and forwards the payload only to the specific ports that requested it.
- **Server layer (SseEmitterService):** Tracks a set of subscribed topics for every active emitter. When publishing an event, the server skips emitters that have not registered interest in that topic, eliminating unnecessary SSE traffic when the user navigates away from a page.

**4\. Unsubscribing From Topics**

When an individual UI component stops listening to a topic, the tab removes its local callback. If other components in that same tab are still listening, neither the SharedWorker nor the server is notified.

Once the last remaining component unsubscribes, the tab sends an unsubscribe message to the worker and a DELETE request to the server. The worker deletes that topic from the port's active list and the server removes it from the emitter's subscription set. In our front-end framework (Ember), we use destructors to automate this cleanup whenever a component or route is destroyed.

**5\. Tab Closure and Navigation**

There are two distinct paths depending on how the tab exits.

When Ember destroys a route or service during in-app navigation, the teardown runs explicitly: it sends a disconnect message to the worker, which removes that port from the registry. If other tabs are still open, the backend SSE connection is completely unaffected. If this was the last tab, the worker closes the SSE connection and becomes idle until the browser terminates it.

When a tab is hard-closed, no JavaScript runs — the teardown never executes and no disconnect message is sent. The worker only discovers the port is gone the next time it tries to write to it, either on an incoming SSE event or on the next heartbeat. At that point the dead port is removed from the registry, and if it was the last one, the SSE connection is closed then.

**6\. Network Disconnections and Server Restarts**

If the network drops or the backend server restarts, the built-in browser behavior of the EventSource API handles the failure.

1. The worker detects the connection error and immediately broadcasts an sse:reconnecting status to all tabs so they can update their internal states.
2. The browser automatically attempts to reconnect in the background.
3. Once restored, the server creates a new emitter and sends a fresh emitter:id event. The worker forwards it to all ports, and each tab re-registers its active topic subscriptions with the server under the new ID.
4. The worker broadcasts an sse:connected confirmation.

Worker-side topic sets are preserved during the drop so tabs do not need to re-announce subscriptions to the worker. However, any events fired by the server while the connection was entirely down are lost unless the backend explicitly supports Last-Event-ID tracking.

**7\. Forced Re-authentication (Post-Login)**

Re-authentication is handled in two explicit steps to avoid a problem with the browser's EventSource auto-reconnect behaviour.

When a user logs out, the backend invalidates the session. If the SSE connection were left open at that point, the EventSource would detect the closure, trigger an error, and immediately start retrying — but each retry carries the now-invalid session cookie and receives a 401. The worker would keep broadcasting a reconnecting status to all tabs in a tight retry loop until something stopped it.

To prevent this, the front-end calls `disconnect()` on the SSE service before the logout request is sent. This clears the stored emitter ID and instructs the worker to close the EventSource cleanly with no auto-reconnect, so by the time the session is invalidated on the server, the connection is already gone.

Once the user logs back in and the browser has received the new session cookie, the front-end calls `connect()`. This instructs the worker to establish a fresh EventSource connection. The server immediately sends a new emitter:id, and each tab re-registers its active topic subscriptions with the server. Worker-side topic sets are untouched across both steps, so events resume without any component needing to re-subscribe.

**8\. Total Downtime and Fresh Restarts**

If all tabs are closed, the worker process is terminated by the browser. When a user returns and opens a new tab later, the architecture executes a complete cold start, mimicking the behavior of the first-ever tab opening. Any backend events published during the period where zero tabs were open are permanently missed by the client.

**9\. Dead Port Detection**

To prevent memory leaks from unexpected crashes (such as a tab crashing hard without firing its disconnect events), the worker uses defensive checks. Whenever the worker attempts to broadcast or route a message, any port that throws an error is instantly flagged as dead. The worker purges these dead ports from its registry and gracefully disconnects from the backend if no healthy tabs remain.

# Demo

TBD
