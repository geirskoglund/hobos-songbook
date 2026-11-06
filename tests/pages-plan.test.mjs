import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planPages, parseDeployment, readDeployment, assertPlanCurrent, repository} from '../scripts/pages-plan.mjs';

const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
const source = (sha = b, pr = 7, kind = 'app') => ({sha, pr, kind});
const metadata = () => ({version: 1, repository, production: source(a, null), preview: source()});
const pull = (patch = {}) => ({state: 'open', number: 7, head: {sha: c, repo: {full_name: repository}},
  base: {ref: 'master', repo: {full_name: repository}}, ...patch});
const run = (patch = {}) => ({conclusion: 'success', event: 'pull_request', head_sha: c,
  repository: {full_name: repository}, head_repository: {full_name: repository}, pull_requests: [{number: 7}], ...patch});
const options = (patch = {}) => ({selection: 'keep', eventName: 'workflow_dispatch', event: {}, masterSha: a,
  previous: metadata(), getPull: async () => pull(), isValidated: async () => true, hasApp: async () => true, ...patch});

test('initial bootstrap is explicit and contains trusted placeholders only', async () => {
  const plan = await planPages(options({previous: null, hasApp: async () => false}));
  assert.deepEqual(plan.metadata.production, source(a, null, 'placeholder'));
  assert.deepEqual(plan.metadata.preview, source(a, null, 'placeholder'));
});
test('production requires exact master validation even on manual dispatch', async () => {
  await assert.rejects(planPages(options({isValidated: async (sha, pr) => sha !== a || pr !== null})), /master/);
});
test('explicit PR selection requires validation of exact PR head and number', async () => {
  const seen = [];
  const plan = await planPages(options({selection: '7', isValidated: async (...args) => {seen.push(args); return true;}}));
  assert.deepEqual(plan.metadata.preview, source(c));
  assert.deepEqual(seen, [[a, null], [c, 7]]);
  assert.equal(plan.followPr, true);
  await assert.rejects(planPages(options({selection: '7', isValidated: async sha => sha !== c})), /testcommit/);
});
test('keep pins the exact previous test SHA after merge and deleted branch', async () => {
  const plan = await planPages(options({masterSha: c, getPull: async () => {throw Error('deleted branch');}}));
  assert.deepEqual(plan.metadata.preview, source());
  assert.equal(plan.metadata.production.sha, c);
  assert.equal(plan.followPr, false);
});
test('explicit master test selection changes preview only to validated master', async () => {
  assert.deepEqual((await planPages(options({selection: 'master'}))).metadata.preview, source(a, null));
});
test('new validated head of selected PR follows automatically', async () => {
  const plan = await planPages(options({eventName: 'workflow_run', event: {workflow_run: run()}}));
  assert.deepEqual(plan.metadata.preview, source(c));
});
test('current master completion publishes production while preserving selected test', async () => {
  const plan = await planPages(options({masterSha: c, eventName: 'workflow_run',
    event: {workflow_run: run({event: 'push', head_sha: c, head_branch: 'master'})}}));
  assert.equal(plan.metadata.production.sha, c);
  assert.deepEqual(plan.metadata.preview, source());
});
test('unselected, stale, failed, fork and unrelated events never deploy', async () => {
  for (const change of [
    {pull_requests: [{number: 8}]}, {head_sha: b}, {event: 'schedule'}, {conclusion: 'failure'},
    {head_repository: {full_name: 'fork/songbook'}}, {repository: {full_name: 'other/repo'}},
    {event: 'push', head_sha: b, head_branch: 'master'}, {event: 'push', head_sha: a, head_branch: 'feature'},
  ]) assert.equal(await planPages(options({eventName: 'workflow_run', event: {workflow_run: run(change)}})), null);
});
test('invalid selections, closed/fork/wrong-base PRs and missing app contract fail', async () => {
  for (const selection of ['0', '-1', '7;bad', '07', '9007199254740992', '']) {
    await assert.rejects(planPages(options({selection})), /Velg/);
  }
  for (const change of [
    {state: 'closed'}, {head: {sha: c, repo: {full_name: 'fork/repo'}}},
    {base: {ref: 'other', repo: {full_name: repository}}},
    {base: {ref: 'master', repo: {full_name: 'other/repo'}}},
  ]) await assert.rejects(planPages(options({selection: '7', getPull: async () => pull(change)})), /åpen PR/);
  await assert.rejects(planPages(options({selection: '7', hasApp: async sha => sha !== c})), /appkontrakten/);
  await assert.rejects(planPages(options({hasApp: async () => false})), /plassholder/);
});
test('bad metadata is rejected for every selection, never silently reset', async () => {
  for (const selection of ['keep', 'master', '7']) {
    await assert.rejects(planPages(options({selection, previous: {...metadata(), version: 2}})), /metadata/);
  }
  for (const field of [{sha: 'master'}, {kind: 'unknown'}, {pr: '7'}, {pr: 0}]) {
    assert.throws(() => parseDeployment({...metadata(), preview: {...source(), ...field}}));
  }
});
test('metadata HTTP errors distinguish first-ever deployment from missing/corrupt existing state', async () => {
  const response = (status, value) => ({status, ok: status === 200, json: async () => value});
  assert.equal(await readDeployment({fetch: async () => response(404), hasPublished: async () => false}), null);
  await assert.rejects(readDeployment({fetch: async () => response(404), hasPublished: async () => true}), /tidligere/);
  for (const status of [403, 500, 503]) await assert.rejects(readDeployment({fetch: async () => response(status)}), /HTTP/);
  await assert.rejects(readDeployment({fetch: async () => {throw Error('network');}}), /network/);
  await assert.rejects(readDeployment({fetch: async () => response(200, {})}), /metadata/);
  assert.deepEqual(await readDeployment({fetch: async () => response(200, metadata()), hasPublished: async () => {throw Error('should not run');}}), metadata());
});
test('stale plans fail if master, test selection, PR head/state or validation changed during build', async () => {
  const plan = await planPages(options({selection: '7'}));
  await assertPlanCurrent(plan, options());
  for (const change of [
    {masterSha: b}, {previous: {...metadata(), preview: source(a, null)}},
    {getPull: async () => pull({state: 'closed'})},
    {getPull: async () => pull({head: {sha: b, repo: {full_name: repository}}})},
    {isValidated: async () => false},
  ]) await assert.rejects(assertPlanCurrent(plan, options(change)));
});
