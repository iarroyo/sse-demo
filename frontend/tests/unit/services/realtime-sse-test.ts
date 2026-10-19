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

    service.subscribe({ eventName: 'folder', resourceId: '123' }, () => {});

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

    service.subscribe({ eventName: 'folder', resourceId: 'aaa' }, () => {});
    service.subscribe({ eventName: 'folder', resourceId: 'bbb' }, () => {});
    service.subscribe({ eventName: 'folder', resourceId: 'ccc' }, () => {});

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

module('Unit | Service | realtime-sse — topics', function (hooks) {
  setupTest(hooks);

  let savedSharedWorker: unknown;

  hooks.beforeEach(function () {
    savedSharedWorker = (window as unknown as Record<string, unknown>)['SharedWorker'];
  });

  hooks.afterEach(function () {
    (window as unknown as Record<string, unknown>)['SharedWorker'] = savedSharedWorker;
  });

  function deliver(port: MockPort, data: unknown) {
    port.onmessage?.({ data } as MessageEvent);
  }

  test('posts one subscribe per distinct topic, comparing topics by value', function (assert) {
    const port = installWorkerMock();
    const service = this.owner.lookup('service:realtime-sse') as RealtimeSseService;
    port.calls.length = 0;

    service.subscribe({ eventName: 'folder', resourceId: '123' }, () => {});
    service.subscribe({ eventName: 'folder', resourceId: '123' }, () => {});
    service.subscribe({ eventName: 'notifications' }, () => {});

    assert.deepEqual(
      postMessageCalls(port).map((c) => c.args[0]),
      [
        { type: 'subscribe', topic: { eventName: 'folder', resourceId: '123' } },
        { type: 'subscribe', topic: { eventName: 'notifications', resourceId: undefined } },
      ],
    );
  });

  test('routes events by eventName and resourceId', function (assert) {
    const port = installWorkerMock();
    const service = this.owner.lookup('service:realtime-sse') as RealtimeSseService;
    const received: string[] = [];

    service.subscribe({ eventName: 'folder', resourceId: '123' }, () => received.push('folder:123'));
    service.subscribe({ eventName: 'folder', resourceId: '456' }, () => received.push('folder:456'));
    service.subscribe({ eventName: 'notifications' }, () => received.push('notifications'));

    deliver(port, { eventName: 'folder', resourceId: '123', payload: {} });
    // The server serialises a missing resourceId as null
    deliver(port, { eventName: 'notifications', resourceId: null, payload: {} });

    assert.deepEqual(received, ['folder:123', 'notifications']);
  });

  test('posts unsubscribe with the topic once the last callback is removed', function (assert) {
    const port = installWorkerMock();
    const service = this.owner.lookup('service:realtime-sse') as RealtimeSseService;

    const unsubA = service.subscribe({ eventName: 'folder', resourceId: '123' }, () => {});
    const unsubB = service.subscribe({ eventName: 'folder', resourceId: '123' }, () => {});
    port.calls.length = 0;

    unsubA();
    assert.strictEqual(postMessageCalls(port).length, 0, 'still one callback left');

    unsubB();
    assert.deepEqual(postMessageCalls(port).map((c) => c.args[0]), [
      { type: 'unsubscribe', topic: { eventName: 'folder', resourceId: '123' } },
    ]);
  });
});

module('Unit | Service | realtime-sse — lifetime lock', function (hooks) {
  setupTest(hooks);

  let savedSharedWorker: unknown;

  hooks.beforeEach(function () {
    savedSharedWorker = (window as unknown as Record<string, unknown>)['SharedWorker'];
  });

  hooks.afterEach(function () {
    (window as unknown as Record<string, unknown>)['SharedWorker'] = savedSharedWorker;
  });

  async function waitForLockName(port: MockPort): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const call = postMessageCalls(port).find(
        (c) => (c.args[0] as Record<string, unknown>)['type'] === 'register-lock',
      );
      if (call) return (call.args[0] as { lockName: string }).lockName;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('register-lock was never posted');
  }

  async function isHeld(lockName: string): Promise<boolean> {
    const { held = [] } = await navigator.locks.query();
    return held.some((l) => l.name === lockName);
  }

  test('posts register-lock with a lock this tab already holds', async function (assert) {
    const port = installWorkerMock();
    const service = this.owner.lookup('service:realtime-sse') as RealtimeSseService;

    const lockName = await waitForLockName(port);

    assert.true(lockName.startsWith('sse-tab-'), 'lock name is namespaced');
    assert.true(await isHeld(lockName), 'lock is held when the worker is told about it');

    destroy(service);
  });

  test('releases the lifetime lock on teardown', async function (assert) {
    const port = installWorkerMock();
    const service = this.owner.lookup('service:realtime-sse') as RealtimeSseService;
    const lockName = await waitForLockName(port);

    destroy(service);

    // Release happens asynchronously once the held promise settles
    let held = true;
    for (let i = 0; i < 50 && held; i++) {
      await new Promise((r) => setTimeout(r, 20));
      held = await isHeld(lockName);
    }
    assert.false(held, 'lock released so the worker can clean up');
  });
});
