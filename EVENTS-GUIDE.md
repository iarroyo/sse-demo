# Server-Sent Events (SSE) Architecture: SharedWorker Guide

## Introduction & System Overview

This document outlines the end-to-end architecture of our Server-Sent Events (SSE) system. It details how browser tabs interact with our backend and defines system behavior across all major operational scenarios.

To optimize performance, the architecture relies on a SharedWorker (sse-worker.js) that acts as a centralized hub inside the browser. Instead of every open tab establishing its own independent connection to the server, all tabs from the same origin share a single EventSource connection. This design pattern successfully bypasses the standard browser limitation of six concurrent connections per origin and significantly reduces unnecessary server load.

## Communication Protocol

The tabs and the SharedWorker communicate via a structured messaging protocol:

### From Tab to Worker

- **Subscribe:** Registers a tab's interest in a specific topic. A topic is an object `{ eventName, resourceId? }`, for example `{ eventName: 'folder', resourceId: '123' }` or `{ eventName: 'notifications' }`. Topics never contain a userId: the server resolves the user from the session and only sends events to that user's connections.
- **Unsubscribe:** Deregisters interest from a topic. Ignored if the tab never subscribed to it.
- **Register Lock:** Tells the worker the name of the Web Lock the tab holds for as long as its page lives, so the worker can tell when the tab is gone (see Dead Port Detection).
- **Disconnect:** Notifies the worker that a port is going away. Because `RealtimeSseService` is an application-scoped service, it is only destroyed when the Ember application itself is torn down — not on route transitions. In practice this message is rarely sent in a normal user session (test teardown or an explicit `app.destroy()` call are the typical triggers). On a hard tab close or any external navigation the JavaScript context is killed immediately and the worker discovers the dead port passively on the next write attempt.
- **Disconnect SSE:** Closes the SSE connection without reconnecting, used on logout so the logged-out browser stops receiving the previous user's events.
- **Connect SSE:** Establishes a fresh SSE connection, typically used after a user re-authenticates.

### From Worker to Tab

- **Worker Ready:** Sent when the initial handshake completes, prompting the tab to re-announce its active subscriptions. Carries only the tab's `portId`.
- **SSE Connected:** Confirms the backend SSE link is established and the server has assigned an emitter ID, so subscriptions can be registered. Sent right away to a new tab if the connection is already up.
- **SSE Reconnecting:** Warns tabs that the network link dropped and the system is attempting to reconnect.
- **Event Route:** Delivers `{ eventName, resourceId, payload }` to the tabs subscribed to that topic.

The server-assigned emitter ID stays inside the worker: the worker, not the tabs, registers and deregisters topic subscriptions with the server via REST.

## Technical Scenarios and Lifecycle Behaviors

**1\. Opening the First Tab**

When a user opens the first tab of the application, no SharedWorker is running yet.

1. The browser spawns a fresh SharedWorker process, which triggers its internal connection logic.
2. The worker registers the new tab's communication port into an internal map (portRegistry) and spins up the main EventSource connection to the backend.
3. The worker sends a worker:ready handshake back to the tab. The SSE transport opens (onopen), but the connection is not yet considered ready.
4. The server sends an emitter:id event as the first SSE frame. The worker stores the UUID, re-registers all active topics with the server via syncServerSubscriptions, and only then broadcasts sse:connected to all ports.
5. The tab receives sse:connected and sets its internal connection status to active. At this point the emitter exists on the server and subscriptions can be registered.

**2\. Opening Subsequent Tabs**

When additional tabs are opened under the same origin, the browser recognizes that a SharedWorker is already active and reuses the existing process.

1. The worker registers the new tab's port alongside the existing ones, but it skips creating a new EventSource connection because the network link is already open.
2. The worker sends a worker:ready signal exclusively to the new tab. Because currentEmitterId is already set, the worker also immediately sends sse:connected to the new port — the tab does not need to wait for onopen or a new emitter:id event.
3. The new tab responds by announcing its active topic subscriptions to the worker. The worker increments `topicRefCount` for each topic and sends a POST to the server only for topics that cross from 0 to 1 — topics already subscribed by another tab are skipped.

**3\. Subscription Management**

The system processes subscriptions using a three-layer approach:

Because two topic objects with the same content are not equal in JavaScript, the app and worker layers index topics by a string key built from `eventName` and `resourceId`. On the server, topics are a Java record that compares by value.

- **App layer (RealtimeSseService):** Manages a map of callbacks for each topic. Multiple UI components within the _same_ tab can listen to the exact same topic. The worker is only notified when the very first component subscribes to a topic in that tab, or when the final component unsubscribes. The service never calls the server directly.
- **Shared Worker layer (sse-worker.js):** Tracks a set of subscribed topics per port for routing, and a global `topicRefCount` map across all open ports. When an event arrives from the server, the worker forwards the payload only to the ports that requested it. The worker owns all REST calls to the server: it sends a POST when `topicRefCount` goes from 0 to 1 (first tab subscribing), and a DELETE when it drops from 1 to 0 (last tab unsubscribing). This prevents one tab's unsubscribe from removing a server subscription that another tab still needs.
- **Server layer (SseEmitterService):** Tracks a set of subscribed topics for every active emitter. When publishing an event, the server skips emitters that have not registered interest in that topic, eliminating unnecessary SSE traffic when the user navigates away from a page.

**4\. Unsubscribing From Topics**

When an individual UI component stops listening to a topic, the tab removes its local callback. If other components in that same tab are still listening, the SharedWorker is not notified.

Once the last remaining component in a tab unsubscribes, the tab sends an unsubscribe message to the worker. The worker removes the topic from that port's active set and decrements the global count. Only if the count reaches zero — meaning no other tab is still subscribed — does the worker send a DELETE request to the server. In our front-end framework (Ember), we use destructors to automate this cleanup whenever a component or route is destroyed.

**5\. Tab Closure and Navigation**

There are two distinct paths depending on how the tab exits.

When the Ember application is explicitly torn down (e.g. programmatic `app.destroy()` or test teardown), the service destructor fires and sends a disconnect message to the worker, which removes that port from the registry. If other tabs are still open, the backend SSE connection is completely unaffected. If this was the last tab, the worker closes the SSE connection and becomes idle until the browser terminates it. In-app route transitions do not trigger this path — the service is application-scoped and stays alive for the entire session.

When a tab is closed, reloaded or crashes, no teardown runs and no disconnect message is sent. Instead, the browser releases the tab's lifetime Web Lock, and the worker, which was waiting on that lock, removes the tab's port and releases its topic subscriptions. If it was the last tab, the browser terminates the worker, which closes the SSE connection; the server cleans up the emitter on its next heartbeat. A page kept in the back/forward cache keeps its lock, and its subscriptions, until it is either restored or evicted (see Dead Port Detection below).

**6\. Network Disconnections and Server Restarts**

If the network drops or the backend server restarts, the built-in browser behavior of the EventSource API handles the failure.

1. The worker detects the connection error and immediately broadcasts an sse:reconnecting status to all tabs so they can update their internal states.
2. The browser automatically attempts to reconnect in the background. If the server answers with an error status instead (for example a 401 after the session expired), the browser stops retrying and the connection stays closed until `connect()` is called.
3. Once restored, the server creates a new emitter and sends a fresh emitter:id event. The worker stores the new ID and immediately re-registers all active topics with the server via `syncServerSubscriptions`. Tabs are not involved in this step.
4. The worker broadcasts an sse:connected confirmation.

Worker-side topic sets are preserved during the drop so tabs do not need to re-announce subscriptions to the worker. However, any events fired by the server while the connection was entirely down are lost unless the backend explicitly supports Last-Event-ID tracking.

**7\. Forced Re-authentication (Post-Login)**

Re-authentication is handled in two explicit steps.

When a user logs out, the backend invalidates the session but does not close the SSE stream: the emitter stays registered to the old user. If the connection were left open, the logged-out browser would keep receiving that user's events.

To prevent this, the front-end calls `disconnect()` on the SSE service before the logout request is sent. This clears the stored emitter ID and instructs the worker to close the EventSource cleanly with no auto-reconnect, so by the time the session is invalidated on the server, the connection is already gone. The server removes the emitter when its next heartbeat write fails.

Once the user logs back in and the browser has received the new session cookie, the front-end calls `connect()`. This instructs the worker to establish a fresh EventSource connection. The server immediately sends a new emitter:id. The worker stores it and re-registers all active topics with the server directly via `syncServerSubscriptions` — tabs are not involved. Worker-side topic sets are untouched across both steps, so events resume without any component needing to re-subscribe.

**8\. Total Downtime and Fresh Restarts**

If all tabs are closed, the worker process is terminated by the browser. When a user returns and opens a new tab later, the architecture executes a complete cold start, mimicking the behavior of the first-ever tab opening. Any backend events published during the period where zero tabs were open are permanently missed by the client.

**9\. Dead Port Detection**

A `MessagePort` gives no signal when the tab on the other side goes away: posting to a closed or crashed tab's port silently does nothing. To detect closed tabs anyway, the system uses the Web Locks API, because the browser releases a page's locks when the page is destroyed — on close, reload, navigation or crash.

1. On startup, each tab requests a uniquely named lock and never releases it.
2. Only once the lock is granted does the tab send its name to the worker. Sending it earlier could let the worker grab the lock first and wrongly conclude the tab is gone.
3. The worker requests the same lock. The request stays queued while the tab is alive.
4. When the tab's page is destroyed, the browser releases the lock and grants the worker's request. The worker then removes the port, releases its topic subscriptions (calling the server only for topics no other tab still needs), and disconnects from the backend if no tabs remain.

A page kept in the back/forward cache is not destroyed, so it keeps its lock and its subscriptions stay registered; they work again if the user returns. If the worker sends it a message while it is cached, the browser evicts the page, which releases the lock.

Web Locks require a secure context (`https` or `localhost`). Where they are unavailable, the service logs a warning and closed tabs are not detected.

In addition, whenever the worker broadcasts or routes a message, any port that throws an error is removed. This only catches messages that can't be serialized.

# Demo

TBD
