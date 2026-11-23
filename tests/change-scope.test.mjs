import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isDocumentation, classifyChanges, docsOnlyStep} from '../scripts/change-scope.mjs';
import {decideScope} from '../scripts/validate-scope.mjs';

test('documentation is a narrow explicit list; everything else is code', () => {
  for (const path of [
    'README.md',
    'CLAUDE.md',
    'GLOSSARY.md',
    'docs/DECISIONS.md',
    'docs/design/icon.svg',
    'docs/agents/domain.md',
  ]) {
    assert.equal(isDocumentation(path), true, path);
  }
  for (const path of [
    'src/main.ts',
    'src/notes.md',
    'public/help.md',
    '.github/workflows/ci.yml',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'scripts/README.md',
    'tests/fixtures/song.md',
    'package.json',
    'package-lock.json',
    'vite.config.mjs',
    'tsconfig.json',
    'index.html',
    'docs.md.ts',
    'mydocs/x.ts',
    '',
    '/docs/x.md',
    'docs/../src/main.ts',
    undefined,
    null,
  ]) {
    assert.equal(isDocumentation(path), false, String(path));
  }
});

test('renames count both names, and empty or truncated lists are code', () => {
  assert.equal(classifyChanges([{filename: 'docs/a.md'}, {filename: 'README.md'}]).docsOnly, true);
  assert.equal(classifyChanges([{filename: 'docs/old.ts', previous_filename: 'src/old.ts'}]).docsOnly, false);
  assert.deepEqual(classifyChanges([{filename: 'docs/a.md'}, {filename: 'src/a.ts'}]).code, ['src/a.ts']);
  assert.equal(classifyChanges([]).docsOnly, false);
  assert.equal(classifyChanges(null).docsOnly, false);
  assert.equal(classifyChanges([{filename: 'docs/a.md'}], false).docsOnly, false);
});

test('ci.yml marks skipped runs with the step name publishing rejects', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes(`- name: '${docsOnlyStep}'`));
  assert.match(workflow, /- run: npm run check\r?\n\s+if: steps\.scope\.outputs\.docs-only != 'true'/);
});

const sha = 'a'.repeat(40);
function scope({
  eventName = 'pull_request',
  files = [{filename: 'docs/a.md'}],
  changed = files.length,
  head = sha,
} = {}) {
  const summary = {
    text: '',
    addHeading(text) {
      this.text += `${text}\n`;
      return this;
    },
    addRaw(text) {
      this.text += text;
      return this;
    },
    addList(items) {
      this.text += items.join('\n');
      return this;
    },
    async write() {},
  };
  const outputs = {};
  const listFiles = () => {};
  const github = {
    rest: {pulls: {get: async () => ({data: {head: {sha: head}, changed_files: changed}}), listFiles}},
    paginate: async method => {
      assert.equal(method, listFiles);
      return files;
    },
  };
  const context = {
    eventName,
    repo: {owner: 'o', repo: 'r'},
    payload: eventName === 'pull_request' ? {pull_request: {number: 7, head: {sha}}} : {},
  };
  return {
    run: () =>
      decideScope({
        github,
        context,
        core: {
          setOutput: (key, value) => {
            outputs[key] = value;
          },
          summary,
        },
      }),
    outputs,
    summary,
  };
}

test('Validate skips heavy steps only for a PR whose complete GitHub file list is documentation', async () => {
  const docs = scope();
  assert.equal((await docs.run()).docsOnly, true);
  assert.equal(docs.outputs['docs-only'], 'true');
  assert.match(docs.summary.text, /Bare dokumentasjon[\s\S]*docs\/a\.md/);
  for (const patch of [
    {eventName: 'push'},
    {files: [{filename: 'docs/a.md'}, {filename: 'src/a.ts'}]},
    {changed: 2},
    {head: 'b'.repeat(40)},
    {files: []},
  ]) {
    const result = scope(patch);
    assert.equal((await result.run()).docsOnly, false, JSON.stringify(patch));
    assert.equal(result.outputs['docs-only'], 'false');
  }
});
