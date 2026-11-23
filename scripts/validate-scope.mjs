import {classifyChanges} from './change-scope.mjs';

// GitHub returns at most 3000 files for a PR; a longer list is never treated as complete.
const maxPullFiles = 3000;

/** Decides whether Validate may skip the heavy steps. The file list comes from GitHub, not from PR code. */
export async function decideScope({github, context, core}) {
  let result = {docsOnly: false, reason: 'Ikke en PR: full validering.', paths: [], code: []};
  if (context.eventName === 'pull_request') {
    const number = context.payload.pull_request?.number;
    const headSha = context.payload.pull_request?.head?.sha;
    const {data: pull} = await github.rest.pulls.get({...context.repo, pull_number: number});
    if (pull.head?.sha !== headSha) {
      result.reason = 'PR-en er endret siden kjøringen startet: full validering.';
    } else {
      const files = await github.paginate(github.rest.pulls.listFiles, {...context.repo, pull_number: number, per_page: 100});
      const complete = files.length === pull.changed_files && files.length < maxPullFiles;
      result = {...classifyChanges(files, complete)};
      result.reason = result.docsOnly ? 'Bare dokumentasjon er endret: installasjon, tester og bygg hoppes over.'
        : complete ? 'PR-en endrer kode: full validering.' : 'Fillisten er ufullstendig: full validering.';
    }
  }
  core.setOutput('docs-only', String(result.docsOnly));
  const summary = core.summary.addHeading('Omfang', 3).addRaw(`${result.reason}\n\n`);
  if (result.docsOnly) summary.addRaw('Filer som avgjorde det:\n\n').addList(result.paths);
  else if (result.code.length) summary.addRaw('Kodefiler:\n\n').addList(result.code.slice(0, 50));
  await summary.write();
  return result;
}
