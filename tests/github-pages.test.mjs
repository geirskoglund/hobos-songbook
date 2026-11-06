import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isValidated, createPlan, checkCurrent} from '../scripts/github-pages.mjs';
import {repository} from '../scripts/pages-plan.mjs';

const sha = 'a'.repeat(40), previewSha = 'b'.repeat(40);
const workflow = {id: 42, path: '.github/workflows/ci.yml', state: 'active'};
const repo = {owner: 'geirskoglund', repo: 'hobos-songbook'};
const run = (patch = {}) => ({id: 100, workflow_id: 42, path: workflow.path, status: 'completed', conclusion: 'success',
  head_sha: sha, head_branch: 'master', event: 'push', repository: {full_name: repository},
  head_repository: {full_name: repository}, pull_requests: [], ...patch});
function client({runs = [run()], jobs = [{name: 'validate', conclusion: 'success', status: 'completed'}], deployments = [], statuses = [], workflowPatch = {}, getContent} = {}) {
  const actions = {getWorkflow: async () => ({data: {...workflow, ...workflowPatch}}),
    listWorkflowRuns: () => {}, listJobsForWorkflowRun: () => {}};
  const repos = {getBranch: async () => ({data: {commit: {sha}}}), listDeployments: () => {}, listDeploymentStatuses: () => {},
    getContent: getContent || (async () => {throw Object.assign(Error('missing'), {status: 404});})};
  return {rest: {actions, repos, pulls: {get: async () => ({data: {state: 'open',
    head: {sha: previewSha, repo: {full_name: repository}}, base: {ref: 'master', repo: {full_name: repository}}}})}},
    paginate: async (method, args) => {
      if (method === actions.listWorkflowRuns) {
        assert.equal(args.workflow_id, 42);
        return runs;
      }
      if (method === actions.listJobsForWorkflowRun) {assert.equal(args.filter, 'latest'); return jobs;}
      if (method === repos.listDeployments) return deployments;
      if (method === repos.listDeploymentStatuses) return statuses;
      throw Error('Unexpected API');
    }};
}
test('source proof requires expected workflow identity, repo, event and exact SHA', async () => {
  assert.equal(await isValidated(client(), repo, sha, null), true);
  for (const patch of [{workflow_id: 99}, {path: '.github/workflows/fake.yml'}, {head_sha: previewSha},
    {repository: {full_name: 'other/repo'}}, {head_repository: {full_name: 'fork/repo'}},
    {event: 'pull_request'}, {head_branch: 'feature'}, {status: 'in_progress'}, {conclusion: 'failure'}]) {
    assert.equal(await isValidated(client({runs: [run(patch)]}), repo, sha, null), false);
  }
  assert.equal(await isValidated(client({workflowPatch: {path: '.github/workflows/fake.yml'}}), repo, sha, null), false);
  assert.equal(await isValidated(client({jobs: [{name: 'validate', status: 'completed', conclusion: 'skipped'}]}), repo, sha, null), false);
  assert.equal(await isValidated(client({jobs: [{name: 'other', status: 'completed', conclusion: 'success'}]}), repo, sha, null), false);
});
test('PR evidence requires PR number, head SHA and master base; latest failed rerun blocks', async () => {
  const prRun = run({event: 'pull_request', head_branch: 'feature', pull_requests: [{number: 7, head: {sha}, base: {ref: 'master'}}]});
  assert.equal(await isValidated(client({runs: [prRun]}), repo, sha, 7), true);
  assert.equal(await isValidated(client({runs: [prRun]}), repo, sha, 8), false);
  for (const pull of [{number: 7, head: {sha: previewSha}, base: {ref: 'master'}}, {number: 7, head: {sha}, base: {ref: 'other'}}]) {
    assert.equal(await isValidated(client({runs: [{...prRun, pull_requests: [pull]}]}), repo, sha, 7), false);
  }
  assert.equal(await isValidated(client({runs: [run(), run({id: 101, conclusion: 'failure'})]}), repo, sha, null), false);
  assert.equal(await isValidated(client({runs: [run({conclusion: 'failure'})]}), repo, sha, null), false);
});
test('trusted workflow adapter plans and rechecks first bootstrap without external services', async () => {
  const github = client(), outputs = {};
  const context = {repo, ref: 'refs/heads/master', sha, eventName: 'workflow_dispatch', payload: {}};
  const core = {setOutput: (key, value) => {outputs[key] = value;}, summary: {addCodeBlock() {return this;}, async write() {}}};
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({status: 404});
  try {
    await createPlan({github, context, core, selection: 'keep'});
    assert.equal(outputs.deploy, true);
    assert.equal(outputs.infra, sha);
    const plan = JSON.parse(outputs.plan);
    assert.equal(plan.metadata.production.kind, 'placeholder');
    assert.deepEqual(JSON.parse(outputs.matrix).include.map(item => item.channel), ['production', 'test']);
    await checkCurrent({github, context, plan});
    await assert.rejects(createPlan({github, context: {...context, ref: 'refs/heads/feature'}, core, selection: 'keep'}), /master/);
    outputs.deploy = null;
    await createPlan({github, context: {...context, sha: previewSha}, core, selection: 'keep'});
    assert.equal(outputs.deploy, 'false');
    await assert.rejects(createPlan({github, context: {...context, eventName: 'workflow_run', payload: {workflow_run: {workflow_id: 999}}}, core, selection: 'keep'}), /ci.yml/);
    await assert.rejects(createPlan({github: client({deployments: [{id: 1}], statuses: [{state: 'success'}]}), context, core, selection: 'keep'}), /tidligere/);
    await assert.rejects(createPlan({github: client({getContent: async () => {throw Object.assign(Error('denied'), {status: 403});}}), context, core, selection: 'master'}), /denied/);
  } finally {globalThis.fetch = previousFetch;}
});
