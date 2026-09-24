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

### 1 — Backend
```bash
cd backend
./mvnw spring-boot:run
# Starts on http://localhost:8080
```

### 2 — Nginx (CloudFront timeout simulator)
```bash
# macOS
brew install nginx

# Start with the project config (standalone, no root needed)
nginx -c $(pwd)/nginx/sse-cf-sim.conf

# Stop
nginx -c $(pwd)/nginx/sse-cf-sim.conf -s stop
```

Nginx listens on `:9090` and forwards to Spring Boot `:8080` with a
**60-second `proxy_read_timeout`** — the same idle-byte timeout CloudFront
applies in production.

### 3 — Frontend
```bash
cd frontend
npm install
npm start
# Dev server on http://localhost:4200
# Vite proxy: /api → localhost:9090 (Nginx) → localhost:8080 (Spring Boot)
```

## Validating the heartbeat

The `SseEmitterService` sends a `:heartbeat` comment every **25 seconds**,
keeping the connection alive well within the 60-second window.

To confirm it works:

| Step | What to do | Expected result |
|---|---|---|
| **Baseline** | Open app, log in, watch browser DevTools → Network → SSE stream | Heartbeat comments arrive every ~25 s |
| **Simulate timeout** | Comment out `@Scheduled` in `SseEmitterService`, restart backend | After 60 s Nginx drops the connection; browser EventSource reconnects (you'll see a new SSE request) |
| **Re-enable heartbeat** | Uncomment `@Scheduled`, restart backend | Connection stays open indefinitely; no reconnects |

You can observe Nginx's behaviour in real time:
```bash
# tail Nginx error log to see upstream timeouts
tail -f /usr/local/var/log/nginx/error.log

# or (Apple Silicon)
tail -f /opt/homebrew/var/log/nginx/error.log
```

## Skipping Nginx (direct mode)

If you want to run without Nginx, change the proxy target in
`frontend/vite.config.mjs`:
```js
target: 'http://localhost:8080',  // direct to Spring Boot
```
