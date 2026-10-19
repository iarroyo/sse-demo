# SSE Demo — Library

A Proof of Concept for Server-Sent Events using:
- **Backend**: Spring Boot / Spring 7 / Tomcat 11 / Java 25
- **Frontend**: Ember.js 7 (GTS) + Shared Worker SSE bridge

## Architecture

```
Browser Tab A          Browser Tab B
     │                      │
     ▼                      ▼
RealtimeSseService     RealtimeSseService
     │    subscribe(topic, cb)
     └────────┐    ┌────────┘
              ▼    ▼
          SharedWorker (sse-worker.js)
          - One SSE connection per browser
          - Routes events to subscribed ports
                │
                │ EventSource /api/sse/connect (session cookie)
                ▼
          [Nginx :9090 — 60 s read timeout (CloudFront sim)]
                │
                ▼
          Spring Boot :8080
          - Per-user SseEmitter map
          - Heartbeat every 25 s keeps timeout from firing
```

## Demo Scenarios

1. Open two browser windows (or use two different browsers)
2. Log in as `alice` in one and `bob` in another (password = username)
3. Alice creates folder "Project X"
4. Alice shares "Project X" with Bob → Bob gets notification
5. Alice creates a document in "Project X" → Bob gets notified (Alice does NOT)
6. Bob navigates to the folder → subscribes to folder-level events
7. Alice adds another document → Bob sees real-time update

## Running

Everything is started from the project root with the Gradle wrapper. Both
tasks run `npm install` in `frontend/` first (skipped when up to date), then
start the Vite dev server in the background and Spring Boot in the foreground.
**Ctrl+C stops everything.**

### Direct mode (default)
```bash
./gradlew dev
```

```
Browser → Vite :4200 → /api → Spring Boot :8080
```

### Through Nginx (CloudFront timeout simulator)
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

To confirm it works:

| Step | What to do | Expected result |
|---|---|---|
| **Baseline** | Start with `./gradlew devNginx`, open app, log in, watch browser DevTools → Network → SSE stream | Heartbeat comments arrive every ~25 s |
| **Simulate timeout** | Comment out `@Scheduled` in `SseEmitterService`, restart backend | After 60 s Nginx drops the connection; browser EventSource reconnects (you'll see a new SSE request) |
| **Re-enable heartbeat** | Uncomment `@Scheduled`, restart backend | Connection stays open indefinitely; no reconnects |

You can observe Nginx's behaviour in real time:
```bash
# tail Nginx error log to see upstream timeouts
tail -f /usr/local/var/log/nginx/error.log

# or (Apple Silicon)
tail -f /opt/homebrew/var/log/nginx/error.log
```
