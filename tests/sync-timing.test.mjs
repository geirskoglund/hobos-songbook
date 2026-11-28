import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syncTiming} from '../src/sync/timing.ts';
import {environment} from '../src/environment.ts';

function withStorage(run) {
  const old = globalThis.localStorage,
    values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  try {
    return run(values);
  } finally {
    globalThis.localStorage = old;
  }
}

test('the timing log runs only on the test address', () =>
  withStorage(values => {
    const timing = syncTiming(environment('production', 'a'.repeat(40)), () => 0);
    timing.begin(true);
    timing.request({operation: 'files/download', status: 200, durationMs: 5});
    timing.end('ok');
    assert.equal(timing.enabled, false);
    assert.equal(timing.has(), false);
    assert.equal(values.size, 0);
  }));

test('a successful run shows calls, phases and time outside calls; overlapping calls count once', () =>
  withStorage(() => {
    let clock = 0;
    const timing = syncTiming(environment('test', 'b'.repeat(40), '115'), () => clock);
    timing.begin(true);
    timing.phase('venter');
    clock = 100;
    timing.phase('venter');
    clock = 400;
    timing.request({operation: 'files/list_folder', status: 200, durationMs: 300});
    clock = 1000;
    timing.request({operation: 'files/download', status: 200, durationMs: 250});
    timing.request({operation: 'files/download', status: 200, durationMs: 150});
    clock = 1200;
    timing.end('ok');
    const text = timing.text();
    assert.match(text, /PR 115/);
    assert.match(text, /manuell ok: 1200 ms, 3 kall, venter på Dropbox 550 ms, utenom kall 650 ms/);
    assert.match(text, /files\/download: 2 kall, 400 ms/);
    assert.match(text, /^ {2}0 \+100 \[venter\]$/m);
    assert.match(text, /^ {2}100 \+300 files\/list_folder 200$/m);
    assert.doesNotMatch(text, /Songbooks|\.cho/);
  }));

test('the log keeps the last ten runs across reloads', () =>
  withStorage(() => {
    const env = environment('test', 'c'.repeat(40));
    const first = syncTiming(env, () => 0);
    for (let run = 0; run < 12; run++) {
      first.begin(run % 2 === 0);
      first.end(run === 11 ? 'failed' : 'ok');
    }
    const reloaded = syncTiming(env, () => 0);
    assert.equal(reloaded.has(), true);
    const text = reloaded.text();
    assert.equal(text.match(/ms, 0 kall,/g).length, 10);
    assert.match(text, /automatisk failed/);
  }));
