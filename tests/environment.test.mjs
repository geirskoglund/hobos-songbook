import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment} from '../src/environment.ts';
import {localSettings} from '../src/storage/local-settings.ts';

test('stable environment identities do not follow PR numbers or build SHA', () => {
  const a = environment('production', 'a'.repeat(40));
  const b = environment('test', 'b'.repeat(40), '7');
  const c = environment('test', 'c'.repeat(40), '8');
  assert.notEqual(a.namespace, b.namespace);
  assert.notEqual(a.base, b.base);
  assert.equal(a.base, '/hobos-songbook/app/');
  assert.equal(b.base, '/hobos-songbook/test/');
  assert.equal(c.namespace, b.namespace);
  assert.equal(c.base, b.base);
  assert.equal(b.name, "Hobo's Songbook Test");
  for (const args of [['unknown', a.sha], ['test', 'master'], ['production', a.sha, '7'], ['test', a.sha, '0'], ['test', a.sha, '9007199254740992']]) assert.throws(() => environment(...args));
});
test('local preference boundary cannot read or remove its sibling settings', () => {
  const values = new Map();
  const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
  const a = localSettings('hobos-songbook-production', storage), b = localSettings('hobos-songbook-test', storage);
  a.set('probe', 'production'); b.set('probe', 'test');
  assert.equal(a.get('probe'), 'production'); assert.equal(b.get('probe'), 'test');
  b.remove('probe'); assert.equal(a.get('probe'), 'production'); assert.equal(b.get('probe'), null);
  assert.throws(() => localSettings('temporary-pr-8', storage));
});
