import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dropboxRate, DropboxError} from '../src/adapters/dropbox-rate.ts';
import {dropboxAdapter} from '../src/adapters/dropbox.ts';
import {DeferredSync, failureCodes} from '../src/core/failure.ts';
import {syncDiagnostics} from '../src/sync/diagnostics.ts';
const limited = (seconds = 0, reason = 'too_many_write_operations', headers = {}) =>
  Response.json(
    {error_summary: 'PRIVATE_PATH', error: {reason: {'.tag': reason}, retry_after: seconds}},
    {status: 429, headers},
  );
async function setup(run) {
  const old = globalThis.localStorage,
    values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  try {
    await run(values);
  } finally {
    globalThis.localStorage = old;
  }
}
test('transient 429 waits and repeats the identical request inside the active operation', () =>
  setup(async () => {
    const events = [],
      gate = dropboxRate(
        'rate',
        () => 'account',
        () => {},
        e => events.push(e),
      );
    let sent = 0,
      first = 0,
      last = 0;
    const result = await gate.send('files/upload', async attempt => {
      sent++;
      if (attempt === 0) {
        first = Date.now();
        return limited();
      }
      last = Date.now();
      return Response.json({id: 'id:file', rev: 'r1'});
    });
    assert.equal(result.status, 200);
    assert.equal(sent, 2);
    assert.ok(last - first >= 990);
    assert.deepEqual(
      events.map(e => e.status),
      [429, 200],
    );
    assert.equal(events[0].limitReason, 'too_many_write_operations');
    assert.equal(events[0].retryAfterMs, 1000);
  }));
test('Retry-After header/body are honored; a long limit stops without sleeping or sending more requests', () =>
  setup(async () => {
    const events = [],
      gate = dropboxRate(
        'rate',
        () => 'account',
        () => {},
        e => events.push(e),
      );
    let sent = 0;
    await assert.rejects(
      gate.send('files/upload', async () => {
        sent++;
        return limited(40, 'too_many_requests', {'Retry-After': '60'});
      }),
      e =>
        e instanceof DropboxError &&
        e.info.code === failureCodes.throttled &&
        e.info.limitReason === 'too_many_requests' &&
        e.info.retryAfterMs > 59000,
    );
    assert.equal(sent, 1);
    assert.equal(events[0].retryAfterMs, 60000);
    gate.begin();
    await assert.rejects(
      gate.send('files/download', async () => {
        sent++;
        return new Response('unexpected');
      }),
      e => e.info.code === failureCodes.throttled,
    );
    assert.equal(sent, 1);
    const restored = dropboxRate(
      'rate',
      () => 'account',
      () => {},
      () => {},
    );
    await assert.rejects(
      restored.send('files/upload', async () => {
        sent++;
        return new Response('unexpected');
      }),
      e => e.info.code === failureCodes.throttled,
    );
    assert.equal(sent, 1);
  }));
test('persistent rate limit is bounded; queued requests stop at the same failure', () =>
  setup(async () => {
    const gate = dropboxRate(
      'rate',
      () => 'account',
      () => {},
      () => {},
    );
    let sent = 0;
    await assert.rejects(
      gate.send('files/upload', async () => {
        sent++;
        return limited();
      }),
      e => e.info.code === failureCodes.throttled,
    );
    assert.equal(sent, 3);
    await assert.rejects(
      gate.send('files/upload', async () => {
        sent++;
        return new Response('unexpected');
      }),
      e => e.info.code === failureCodes.throttled,
    );
    assert.equal(sent, 3);
  }));
test('move settlement respects an HTTP 429 beyond the remaining wait budget', () =>
  setup(async () => {
    const gate = dropboxRate(
        'rate',
        () => 'account',
        () => {},
        () => {},
      ),
      requests = [];
    const exhausted = error => error.info.code === failureCodes.throttled && error.info.stage === 'dropbox.move-batch';
    await assert.rejects(
      gate.send(
        'files/move_batch_v2',
        async () => {
          requests.push('move');
          return limited(60);
        },
        undefined,
        {namespacePlanAttempt: 2},
      ),
      exhausted,
    );
    await assert.rejects(
      gate.send(
        'files/list_folder/continue',
        async () => {
          requests.push('metadata');
          return new Response('unexpected');
        },
        undefined,
        {settlement: 'move-receipt'},
      ),
      exhausted,
    );
    await assert.rejects(
      gate.send('files/move_batch_v2', async () => {
        requests.push('move');
        return new Response('unexpected');
      }),
      exhausted,
    );
    assert.deepEqual(requests, ['move']);
  }));
test('a fence release respects an HTTP 429 beyond the remaining wait budget', () =>
  setup(async () => {
    const gate = dropboxRate(
        'rate',
        () => 'account',
        () => {},
        () => {},
      ),
      requests = [];
    const exhausted = error => error.info.code === failureCodes.throttled && error.info.retryAfterMs > 30000;
    await assert.rejects(
      gate.send('sharing/list_shared_links', async () => {
        requests.push('lookup');
        return limited(60);
      }),
      exhausted,
    );
    await assert.rejects(
      gate.send(
        'files/upload',
        async () => {
          requests.push('release');
          return new Response('unexpected');
        },
        undefined,
        {settlement: 'fence-release'},
      ),
      exhausted,
    );
    assert.deepEqual(requests, ['lookup']);
  }));
test('a shared cooldown prevents new requests and serializes remaining writes after 429', () =>
  setup(async () => {
    const gate = dropboxRate(
      'rate',
      () => 'account',
      () => {},
      () => {},
    );
    let resolveFirst,
      first = true,
      limitedAt = 0;
    const started = new Promise(resolve => (resolveFirst = resolve)),
      starts = [];
    let active = 0,
      maxAfter = 0;
    const write = () =>
      gate.send('files/upload', async () => {
        const now = Date.now();
        starts.push(now);
        if (first) {
          first = false;
          limitedAt = now;
          resolveFirst();
          return limited();
        }
        active++;
        maxAfter = Math.max(maxAfter, active);
        await new Promise(resolve => setTimeout(resolve, 10));
        active--;
        return Response.json({ok: true});
      });
    const initial = write();
    await started;
    await new Promise(setImmediate);
    await Promise.all([initial, ...Array.from({length: 8}, write)]);
    assert.ok(starts.slice(1).every(time => time - limitedAt >= 990));
    assert.equal(maxAfter, 1);
  }));
test('cancellation wakes cooldown immediately and cannot send an old operation in a new run', () =>
  setup(async () => {
    let signal;
    const reached = new Promise(resolve => (signal = resolve));
    const gate = dropboxRate(
      'rate',
      () => 'account',
      () => {},
      () => {},
    );
    let sent = 0;
    const pending = gate.send('files/upload', async () => {
      sent++;
      signal();
      return limited(10);
    });
    await reached;
    await new Promise(setImmediate);
    gate.cancel();
    await assert.rejects(pending, e => e instanceof DeferredSync);
    assert.equal(sent, 1);
    gate.begin(false);
    await assert.rejects(
      gate.send('files/upload', async () => {
        sent++;
        return new Response('unexpected');
      }),
      e => e.info.code === failureCodes.throttled,
    );
    assert.equal(sent, 1);
  }));
test('cooldown is account/environment scoped, and user disconnect does not wait behind it', () =>
  setup(async () => {
    const gate = dropboxRate(
      'test',
      () => 'old-account',
      () => {},
      () => {},
    );
    await assert.rejects(
      gate.send('files/upload', async () => limited(60)),
      e => e.info.code === failureCodes.throttled,
    );
    const other = dropboxRate(
        'test',
        () => 'new-account',
        () => {},
        () => {},
      ),
      production = dropboxRate(
        'production',
        () => 'old-account',
        () => {},
        () => {},
      );
    assert.equal((await other.send('files/upload', async () => new Response('ok'))).status, 200);
    assert.equal((await production.send('files/upload', async () => new Response('ok'))).status, 200);
    assert.equal((await gate.send('auth/token/revoke', async () => new Response('ok'))).status, 200);
  }));
test('best effort logging never retries rate limiting', () =>
  setup(async () => {
    const gate = dropboxRate(
      'rate',
      () => 'account',
      () => {},
      () => {},
    );
    gate.begin(false);
    let sent = 0;
    await assert.rejects(
      gate.send('files/upload', async () => {
        sent++;
        return limited();
      }),
      e => e.info.code === failureCodes.throttled,
    );
    assert.equal(sent, 1);
  }));
test('adapter retries preserve add/update mode, rev and bytes; a new revision remains an ordinary conflict', () =>
  setup(async values => {
    const old = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {locks: {request: async (_name, fn) => fn()}},
    });
    const env = {channel: 'test', namespace: 'rate'};
    values.set(
      'rate:dropbox-auth-v1',
      JSON.stringify({
        version: 1,
        accountId: 'account',
        refreshToken: 'refresh',
        accessToken: 'access',
        expires: Date.now() + 3600000,
      }),
    );
    try {
      const calls = [];
      const adapter = dropboxAdapter(env, async (_url, options) => {
        calls.push(options);
        return calls.length === 1 ? limited() : Response.json({error_summary: 'path/conflict/file/'}, {status: 409});
      });
      await assert.rejects(
        adapter.files.write('/Songbooks/A/Private/a.cho', '{t: Uendret}\r\n', 'expected-rev'),
        e => e instanceof DropboxError && e.status === 409,
      );
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0].body, calls[1].body);
      assert.equal(calls[0].headers['Dropbox-API-Arg'], calls[1].headers['Dropbox-API-Arg']);
      assert.deepEqual(JSON.parse(calls[1].headers['Dropbox-API-Arg']).mode, {
        '.tag': 'update',
        update: 'expected-rev',
      });
    } finally {
      if (old) Object.defineProperty(globalThis, 'navigator', old);
      else delete globalThis.navigator;
    }
  }));
test('logs allow only rate reason, numeric wait and bounded attempt, never API content', () =>
  setup(async () => {
    const env = {channel: 'test', namespace: 'rate', sha: 'a'.repeat(40), pr: 38},
      diagnostics = syncDiagnostics(env);
    const {entry} = diagnostics.record(
      new DropboxError(429, 'PRIVATE_PATH', 'dropbox.request', {
        limitReason: 'too_many_write_operations',
        retryAfterMs: 1200,
      }),
      'sync.run',
      false,
      [
        {
          operation: 'files/upload',
          status: 429,
          durationMs: 10,
          limitReason: 'too_many_write_operations',
          retryAfterMs: 1200,
          retryAttempt: 1,
          error_summary: 'PRIVATE_ACCOUNT',
          headers: 'PRIVATE_TOKEN',
          path: 'PRIVATE_PATH',
        },
      ],
    );
    const text = diagnostics.text(entry);
    assert.ok(!text.includes('PRIVATE_'));
    assert.equal(entry.failure.limitReason, 'too_many_write_operations');
    assert.equal(entry.operations[0].retryAfterMs, 1200);
    assert.equal(entry.operations[0].retryAttempt, 1);
    const invalid = diagnostics.record(
      new DropboxError(429, 'PRIVATE_PATH', 'dropbox.request', {limitReason: 'PRIVATE_REASON', retryAfterMs: -10}),
      'sync.run',
      true,
      [],
    ).entry;
    assert.equal(invalid.failure.limitReason, undefined);
    assert.equal(invalid.failure.retryAfterMs, undefined);
  }));
test('HTTP-date Retry-After and unknown reasons are safely reduced to duration and an allowlisted category', () =>
  setup(async () => {
    const gate = dropboxRate(
      'rate',
      () => 'account',
      () => {},
      () => {},
    );
    await assert.rejects(
      gate.send('files/upload', async () =>
        limited(0, 'PRIVATE_REASON', {'Retry-After': new Date(Date.now() + 60000).toUTCString()}),
      ),
      e => e.info.retryAfterMs > 50000 && e.info.limitReason === 'unknown',
    );
    const malformed = dropboxRate(
      'other',
      () => 'account',
      () => {},
      () => {},
    );
    malformed.begin(false);
    await assert.rejects(
      malformed.send('files/upload', async () =>
        Response.json(
          {error: {reason: {'.tag': 'PRIVATE_REASON'}, retry_after: 'PRIVATE_VALUE'}},
          {status: 429, headers: {'Retry-After': 'PRIVATE_HEADER'}},
        ),
      ),
      e => e.info.limitReason === 'unknown' && e.info.retryAfterMs === 1000,
    );
  }));
test('zero Retry-After still backs off enough to recover while another device holds the namespace busy', () =>
  setup(async () => {
    const gate = dropboxRate(
      'rate',
      () => 'account',
      () => {},
      () => {},
    );
    const started = Date.now();
    let sent = 0;
    const response = await gate.send('files/upload', async () => {
      sent++;
      return Date.now() - started < 1500 ? limited() : new Response('ok');
    });
    assert.equal(response.status, 200);
    assert.equal(sent, 3);
  }));
test('a terminal limit wakes other requests already waiting in the same run', () =>
  setup(async () => {
    const gate = dropboxRate(
      'rate',
      () => 'account',
      () => {},
      () => {},
    );
    let release;
    const held = new Promise(resolve => (release = resolve)),
      second = gate.send('files/download', () => held);
    const first = gate.send('files/download', async () => limited());
    await new Promise(setImmediate);
    const started = Date.now();
    release(limited(60));
    const results = await Promise.allSettled([first, second]);
    assert.ok(results.every(r => r.status === 'rejected' && r.reason.info.code === failureCodes.throttled));
    assert.ok(Date.now() - started < 750);
  }));
