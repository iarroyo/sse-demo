import { module, test } from 'qunit';
import { setupTest } from 'ember-qunit';
import { destroy } from '@ember/destroyable';
import type RealtimeSseService from 'sse-demo/services/realtime-sse';

// ---------------------------------------------------------------------------
// Minimal SharedWorker mock
//
// Replaces `window.SharedWorker` before each test so the service never tries
// to contact a real worker. All `port` calls are recorded in `calls` for
// assertion.
// ---------------------------------------------------------------------------

interface Call {
  method: string;
  args: unknown[];
}

interface MockPort {
  calls: Call[];
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  postMessage(msg: unknown): void;
  close(): void;
  start(): void;
}

function installWorkerMock(): MockPort {
  const calls: Call[] = [];

  const port: MockPort = {
    calls,
    onmessage: null,
    onerror: null,
    postMessage(msg: unknown) {
      calls.push({ method: 'postMessage', args: [msg] });
    },
    close() {
      calls.push({ method: 'close', args: [] });
    },
    start() {
      calls.push({ method: 'start', args: [] });
    },
  };

  function MockSharedWorker(this: { port: MockPort }) {
    this.port = port;
  }

  (window as unknown as Record<string, unknown>)['SharedWorker'] = MockSharedWorker;

  return port;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postMessageCalls(port: MockPort): Call[] {
  return port.calls.filter((c) => c.method === 'postMessage');
}

function hasDisconnect(port: MockPort): boolean {
  return postMessageCalls(port).some(
    (c) => (c.args[0] as Record<string, unknown>)['type'] === 'disconnect',
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

module('Unit | Service | realtime-sse — teardown (tab close)', function (hooks) {
  setupTest(hooks);

  let savedSharedWorker: unknown;

  hooks.beforeEach(function () {
    savedSharedWorker = (window as unknown as Record<string, unknown>)['SharedWorker'];
  });

  hooks.afterEach(function () {
    (window as unknown as Record<string, unknown>)['SharedWorker'] = savedSharedWorker;
  });

  // ── Core teardown behaviour ────────────────────────────────────────────────

  test('sends { type: "disconnect" } to the worker port when the service is destroyed', function (assert) {
    const port = installWorkerMock();
    const service = this.owner.lookup('service:realtime-sse') as RealtimeSseService;

    service.subscribe('folder:123', () => {});

    port.calls.length = 0; // discard subscribe setup calls

    destroy(service);

    assert.true(hasDisconnect(port), 'posts { type: "disconnect" } during teardown');
  });

  test('closes the worker port when the service is destroyed', function (assert) {
    const port = installWorkerMock();
    const service = this.owner.lookup('service:realtime-sse') as RealtimeSseService;

    port.calls.length = 0;

    destroy(service);

    const closeCall = port.calls.find((c) => c.method === 'close');
    assert.ok(closeCall, 'port.close() is called during teardown');
  });

  // ── Single disconnect regardless of subscription count ────────────────────
  //
  // Teardown sends ONE disconnect rather than individual unsubscribe messages
  // per topic. The worker handles cleanup on its side when it receives disconnect.

  test('sends exactly one postMessage (disconnect) regardless of active topic count', function (assert) {
    const port = installWorkerMock();
    const service = this.owner.lookup('service:realtime-sse') as RealtimeSseService;

    service.subscribe('folder:aaa', () => {});
    service.subscribe('folder:bbb', () => {});
    service.subscribe('folder:ccc', () => {});

    port.calls.length = 0;

    destroy(service);

    const msgs = postMessageCalls(port);
    assert.strictEqual(msgs.length, 1, 'exactly one postMessage on teardown');
    assert.deepEqual(msgs[0]?.args[0], { type: 'disconnect' }, 'the message is disconnect');
  });

  // ── Order: disconnect before close ────────────────────────────────────────

  test('posts disconnect before closing the port', function (assert) {
    const port = installWorkerMock();
    const service = this.owner.lookup('service:realtime-sse') as RealtimeSseService;

    port.calls.length = 0;
    destroy(service);

    const idxDisconnect = port.calls.findIndex(
      (c) =>
        c.method === 'postMessage' &&
        (c.args[0] as Record<string, unknown>)['type'] === 'disconnect',
    );
    const idxClose = port.calls.findIndex((c) => c.method === 'close');

    assert.true(idxDisconnect < idxClose, 'disconnect is sent before port is closed');
  });

  // ── No double-teardown ─────────────────────────────────────────────────────
  //
  // Ember's destroyable system guarantees destructors run once.
  // Verify that destroying an already-destroyed service does not send a second
  // disconnect.

  test('does not send a second disconnect if destroyed twice', function (assert) {
    const port = installWorkerMock();
    const service = this.owner.lookup('service:realtime-sse') as RealtimeSseService;

    destroy(service);
    port.calls.length = 0;
    destroy(service); // second call — destructor should not fire again

    const disconnectCalls = postMessageCalls(port).filter(
      (c) => (c.args[0] as Record<string, unknown>)['type'] === 'disconnect',
    );
    assert.strictEqual(disconnectCalls.length, 0, 'no second disconnect on double-destroy');
  });

  // ── Graceful degradation when SharedWorker is absent ──────────────────────

  test('does not throw on teardown when SharedWorker is unavailable', function (assert) {
    (window as unknown as Record<string, unknown>)['SharedWorker'] = undefined;

    const service = this.owner.lookup('service:realtime-sse') as RealtimeSseService;

    try {
      destroy(service);
      assert.ok(true, 'teardown completed without throwing');
    } catch (e) {
      assert.ok(false, `teardown threw unexpectedly: ${e}`);
    }
  });
});
