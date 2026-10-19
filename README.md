# SSE Demo — Library

A Proof of Concept for Server-Sent Events using:
- **Backend**: Spring Boot 3.4 (Spring Framework 6.2, embedded Tomcat 10.1) / Java 21
- **Frontend**: Ember.js 7 (GTS, Vite + Embroider) + Shared Worker SSE bridge

## Architecture

```
Browser Tab A          Browser Tab B
     │                      │
     ▼                      ▼
RealtimeSseService     RealtimeSseService
     │    subscribe({ eventName, resourceId }, cb)
     └────────┐    ┌────────┘
              ▼    ▼
          SharedWorker (sse-worker.js)
          - One SSE connection per browser
          - Ref-counts topics across tabs, syncs with
            POST/DELETE /api/sse/subscriptions
          - Routes events to subscribed ports
                │
                │ EventSource /api/sse/connect (session cookie)
                ▼
          [Nginx :9090 — 60 s read timeout (CloudFront sim)]
                │
                ▼
          Spring Boot :8080
          - Per-user SseEmitter map
          - Per-emitter topic subscriptions
          - Heartbeat every 25 s keeps timeout from firing
```

## Topics

A topic is a JSON object with two properties:

| Property | Required | Description |
|---|---|---|
| `eventName` | yes | Kind of event stream, e.g. `folder` or `notifications` |
| `resourceId` | no | Identifier of the resource the stream is about (e.g. the folder id) |

Topics in use:

| Topic | Events |
|---|---|
| `{ "eventName": "folder", "resourceId": "<folderId>" }` | `DOCUMENT_CREATED`, `DOCUMENT_DELETED` in that folder |
| `{ "eventName": "notifications" }` | `FOLDER_SHARED`, `DOCUMENT_CREATED_NOTIFICATION` for the current user |

Topics never contain a userId. The server works out the user from the session
cookie and only sends an event to that user's emitters, so every user can
subscribe to the same `notifications` topic and still only get their own
events.

**Subscribing:** the SharedWorker calls these endpoints with the topic as
the JSON body and the connection's `X-Emitter-Id` header:

```http
POST   /api/sse/subscriptions   { "eventName": "folder", "resourceId": "abc" }
DELETE /api/sse/subscriptions   { "eventName": "folder", "resourceId": "abc" }
```

**Events:** each SSE `message` event carries the topic next to the payload:

```json
{ "eventName": "folder", "resourceId": "abc", "payload": { "type": "DOCUMENT_CREATED", "...": "..." } }
```

For `notifications`, `resourceId` is `null`.

**In Ember:**

```ts
const unsub = this.realtimeSse.subscribe(
  { eventName: 'folder', resourceId: folderId },
  (payload) => { /* ... */ },
);
registerDestructor(this, unsub);
```

## Demo Scenarios

1. Open two browser windows (or use two different browsers)
2. Log in as `alice` in one and `bob` in another (password = username;
   `charlie` is also available)
3. Alice creates folder "Project X"
4. Alice shares "Project X" with Bob → Bob gets a `FOLDER_SHARED` notification
5. Alice creates a document in "Project X" → Bob, on his library page, gets a
   `DOCUMENT_CREATED_NOTIFICATION` (Alice does NOT)
6. Bob opens the folder → subscribes to `{ eventName: "folder", resourceId: <id> }`
7. Alice adds or deletes a document → Bob's document list updates in real time

## Running

### Prerequisites

- **JDK 21**, used by the backend's Gradle toolchain
- **Node.js ≥ 20.19**
- **nginx** (optional), only for `devNginx`

### Starting the stack

Everything is started from the project root with the Gradle wrapper. Both
tasks run `npm install` in `frontend/` first (skipped when up to date), then
start the Vite dev server in the background and Spring Boot in the foreground.
**Ctrl+C stops everything.**

#### Direct mode (default)
```bash
./gradlew dev
```

```
Browser → Vite :4200 → /api → Spring Boot :8080
```

#### Through Nginx (CloudFront timeout simulator)
Requires `nginx` on your `PATH` (macOS: `brew install nginx`).

```bash
./gradlew devNginx
```

```
Browser → Vite :4200 → /api → Nginx :9090 → Spring Boot :8080
```

Nginx is started with [nginx/sse-cf-sim.conf](nginx/sse-cf-sim.conf) and
stopped automatically on exit. It forwards to Spring Boot with a
**60-second `proxy_read_timeout`** — the same idle-byte timeout CloudFront
applies in production. Use this mode to validate the heartbeat (below).

Open the app at http://localhost:4200.

### Running pieces individually
```bash
# Backend — http://localhost:8080
cd backend && ./gradlew bootRun

# Frontend — http://localhost:4200
# BACKEND_PORT sets the Vite /api proxy target (default 8080; use 9090 for Nginx)
cd frontend && npm install && BACKEND_PORT=8080 npm start

# Nginx — :9090
nginx -c $(pwd)/nginx/sse-cf-sim.conf           # start
nginx -c $(pwd)/nginx/sse-cf-sim.conf -s stop   # stop
```

## Validating the heartbeat

The `SseEmitterService` sends a `:heartbeat` comment every **25 seconds**,
keeping the connection alive well within the 60-second window.

Browser DevTools doesn't show SSE comments in the EventStream tab, so watch
the raw stream through Nginx with `curl` instead (run with `./gradlew devNginx`):

```bash
# Log in and keep the session cookie
curl -s -c /tmp/sse-cookies -d 'username=alice&password=alice' \
  http://localhost:9090/api/auth/login

# Stream events; ":heartbeat" lines should appear every ~25 s
curl -N -b /tmp/sse-cookies http://localhost:9090/api/sse/connect
```

To confirm it works:

| Step | What to do | Expected result |
|---|---|---|
| **Baseline** | Run the `curl` stream above | `:heartbeat` lines every ~25 s; the stream stays open |
| **Simulate timeout** | Comment out `@Scheduled` on `sendHeartbeat()` in `SseEmitterService`, restart backend | After 60 s with no bytes, Nginx closes the stream. In the app, the EventSource reconnects (a new `/api/sse/connect` request in DevTools → Network); the SharedWorker gets a new emitter id and re-subscribes to all active topics |
| **Re-enable heartbeat** | Uncomment `@Scheduled`, restart backend | Connection stays open indefinitely; no reconnects |

You can observe Nginx's behaviour in real time:
```bash
# tail Nginx error log to see upstream timeouts
tail -f /usr/local/var/log/nginx/error.log

# or (Apple Silicon)
tail -f /opt/homebrew/var/log/nginx/error.log
```
