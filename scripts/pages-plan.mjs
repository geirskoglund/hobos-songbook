export const repository = 'geirskoglund/hobos-songbook';
export const siteUrl = 'https://geirskoglund.github.io/hobos-songbook/';
export const paths = {production: 'app/', preview: 'test/'};
export const validSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const validPr = value => Number.isSafeInteger(value) && value > 0;
const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function parseDeployment(value) {
  requireThat(value?.version === 1 && value.repository === repository, 'Ugyldig publiseringsmetadata.');
  const result = {version: 1, repository};
  for (const target of ['production', 'preview']) {
    const item = value[target];
    requireThat(
      validSha(item?.sha) && ['app', 'placeholder'].includes(item.kind),
      'Ugyldig kildecommit eller byggtype.',
    );
    requireThat(
      target === 'production' ? item.pr === null : item.pr === null || validPr(item.pr),
      'Ugyldig PR-identitet.',
    );
    requireThat(!(item.kind === 'placeholder' && item.pr !== null), 'En PR må inneholde appkontrakten.');
    result[target] = {sha: item.sha, pr: item.pr, kind: item.kind};
  }
  return result;
}

// A 404 is initialization only when GitHub confirms no previous successful Pages deployment.
// Always read existing metadata, even for an explicit new selection.
export async function readDeployment({fetch, hasPublished}) {
  const response = await fetch(new URL(`deployment.json?run=${Date.now()}`, siteUrl), {
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) {
    requireThat(
      !(await hasPublished()),
      'Metadata mangler etter tidligere publisering. Stopp og gjenopprett metadata.',
    );
    return null;
  }
  requireThat(response.ok, `Kan ikke lese publiseringsmetadata: HTTP ${response.status}.`);
  return parseDeployment(await response.json());
}

function eligiblePull(pull) {
  return (
    pull?.state === 'open' &&
    pull.head?.repo?.full_name === repository &&
    pull.base?.repo?.full_name === repository &&
    pull.base?.ref === 'master' &&
    validSha(pull.head?.sha)
  );
}

/** All input is data. No branch, issue text or PR code is executed by the planner. */
export async function planPages({
  selection = 'keep',
  eventName,
  event,
  masterSha,
  previous,
  getPull,
  isValidated,
  isTested,
  hasApp,
  docsOnlySince = async () => false,
  trigger = 'validate',
}) {
  requireThat(validSha(masterSha), 'Ugyldig master-commit.');
  const old = previous === null ? null : parseDeployment(previous);
  requireThat(['workflow_run', 'workflow_dispatch'].includes(eventName), 'Uventet publiseringshendelse.');
  requireThat(
    selection === 'keep' || selection === 'master' || (/^[1-9][0-9]*$/.test(selection) && validPr(Number(selection))),
    'Velg keep, master eller PR-nummer.',
  );
  // Test needs only Validate. E2E on a PR gates merge, not publishing, so its completion changes nothing here.
  if (eventName === 'workflow_run' && trigger !== 'validate' && event.workflow_run?.event !== 'push') return null;
  // Master channels publish the latest code change once Validate and E2E are green for it. Until E2E is green,
  // and when everything after the published production commit is documentation (scripts/change-scope.mjs),
  // the published production is kept, so users get no untested or unchanged update.
  let held = null;
  if (old && old.production.sha !== masterSha) {
    if ((await docsOnlySince(old.production.sha, masterSha)) === true) held = 'docs';
    else if (!(await isTested(masterSha))) held = 'e2e';
  }
  const keepProduction = held !== null;
  const masterSource = keepProduction ? old.production.sha : masterSha;
  let preview = selection === 'keep' && old ? {...old.preview} : {sha: masterSource, pr: null};
  let followPr = false;
  if (/^[1-9][0-9]*$/.test(selection)) {
    const pull = await getPull(Number(selection));
    requireThat(eligiblePull(pull), 'Test krever åpen PR fra samme repo mot master.');
    preview = {sha: pull.head.sha, pr: Number(selection)};
    followPr = true;
  }
  if (eventName === 'workflow_run') {
    const run = event.workflow_run;
    if (
      run?.conclusion !== 'success' ||
      run.repository?.full_name !== repository ||
      run.head_repository?.full_name !== repository
    )
      return null;
    if (run.event === 'push') {
      if (run.head_branch !== 'master' || run.head_sha !== masterSha) return null;
    } else if (run.event === 'pull_request' && preview.pr) {
      const pull = await getPull(preview.pr);
      if (
        !eligiblePull(pull) ||
        pull.head.sha !== run.head_sha ||
        preview.sha === pull.head.sha ||
        !run.pull_requests?.some(pr => pr.number === preview.pr)
      )
        return null;
      preview = {sha: pull.head.sha, pr: preview.pr};
      followPr = true;
    } else return null;
  }
  requireThat(await isValidated(masterSha, null), 'Eksakt master-commit mangler grønn Validate/push.');
  if (!old) requireThat(await isTested(masterSha), 'Eksakt master-commit mangler grønn E2E/push.');
  if (keepProduction)
    requireThat(await isValidated(masterSource, null), 'Publisert produksjonscommit mangler grønn Validate/push.');
  requireThat(await isValidated(preview.sha, preview.pr), 'Eksakt testcommit mangler grønn Validate fra riktig kilde.');
  const production = keepProduction
    ? {...old.production}
    : {sha: masterSha, pr: null, kind: (await hasApp(masterSha)) ? 'app' : 'placeholder'};
  if (old?.production.kind === 'app')
    requireThat(production.kind === 'app', 'Produksjonsappen kan ikke bli en plassholder.');
  preview.kind =
    preview.sha === production.sha
      ? production.kind
      : preview.kind || ((await hasApp(preview.sha)) ? 'app' : 'placeholder');
  const metadata = parseDeployment({version: 1, repository, production, preview});
  // An automatic run that would publish exactly what is already published, does not deploy.
  if (eventName === 'workflow_run' && JSON.stringify(metadata) === JSON.stringify(old)) return null;
  return {metadata, previous: old, followPr, master: masterSha, held};
}

/** Recheck immediately before uploading/deploying; queued runs cannot overwrite newer state. */
export async function assertPlanCurrent(plan, {masterSha, previous, getPull, isValidated, isTested}) {
  requireThat(validSha(plan.master) && masterSha === plan.master, 'Master er endret under bygg. Kjør ny publisering.');
  const current = previous === null ? null : parseDeployment(previous);
  requireThat(JSON.stringify(current) === JSON.stringify(plan.previous), 'Publisert testvalg er endret under bygg.');
  if (plan.followPr) {
    const pull = await getPull(plan.metadata.preview.pr);
    requireThat(
      eligiblePull(pull) && pull.head.sha === plan.metadata.preview.sha,
      'Valgt PR er endret eller lukket under bygg.',
    );
  }
  for (const source of [plan.metadata.production, plan.metadata.preview]) {
    requireThat(await isValidated(source.sha, source.pr), 'Kildevalidering er ikke lenger grønn.');
  }
  const {production} = plan.metadata;
  if (production.sha !== plan.previous?.production.sha)
    requireThat(await isTested(production.sha), 'Ny produksjonscommit mangler grønn E2E.');
}
