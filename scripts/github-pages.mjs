import {repository, readDeployment, planPages, assertPlanCurrent} from './pages-plan.mjs';
import {classifyChanges, docsOnlyStep} from './change-scope.mjs';

// GitHub's compare API lists at most 300 files; a longer list is never treated as complete.
const maxCompareFiles = 300;

// The workflow's identity and source are checked through Actions, never by a check name alone.
export async function validatedRun(github, repo, sha, pr) {
  const {data: workflow} = await github.rest.actions.getWorkflow({...repo, workflow_id: 'ci.yml'});
  if (workflow.path !== '.github/workflows/ci.yml' || workflow.state !== 'active') return false;
  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    ...repo,
    workflow_id: workflow.id,
    head_sha: sha,
    event: pr === null ? 'push' : 'pull_request',
    per_page: 100,
  });
  const candidates = runs.filter(
    run =>
      run.workflow_id === workflow.id &&
      run.path === workflow.path &&
      run.head_sha === sha &&
      run.repository?.full_name === repository &&
      run.head_repository?.full_name === repository &&
      run.event === (pr === null ? 'push' : 'pull_request') &&
      (pr !== null || run.head_branch === 'master'),
  );
  let frozenSource;
  const matches = [];
  for (const run of candidates) {
    if (
      pr === null ||
      run.pull_requests?.some(pull => pull.number === pr && pull.head?.sha === sha && pull.base?.ref === 'master')
    ) {
      matches.push(run);
    } else if (run.pull_requests?.length === 0) {
      // GitHub removes run.pull_requests after merge. Recover the historical binding
      // from GitHub's commit/PR association, only for an already closed same-repo PR.
      if (frozenSource === undefined) {
        const {data: pull} = await github.rest.pulls.get({...repo, pull_number: pr});
        frozenSource = false;
        if (
          pull.state === 'closed' &&
          pull.head?.repo?.full_name === repository &&
          pull.base?.ref === 'master' &&
          pull.base?.repo?.full_name === repository
        ) {
          const associated = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit, {
            ...repo,
            commit_sha: sha,
            per_page: 100,
          });
          frozenSource = associated.some(item => item.number === pr);
        }
      }
      if (frozenSource) matches.push(run);
    }
  }
  const latest = matches.sort((a, b) => b.id - a.id)[0];
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') return false;
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
    ...repo,
    run_id: latest.id,
    filter: 'latest',
    per_page: 100,
  });
  const job = jobs.find(
    item => item.name === 'validate' && item.conclusion === 'success' && item.status === 'completed',
  );
  if (!job) return null;
  // A documentation-only PR run is green without install, tests or build. It never counts as validated source.
  if (
    job.steps?.some(
      step =>
        (step.name === docsOnlyStep && step.conclusion === 'success') ||
        (step.name === 'Run npm run check' && step.conclusion !== 'success'),
    )
  ) {
    throw new Error(
      `Commit ${sha}${pr === null ? '' : ` i PR #${pr}`} er ikke validert: Validate gjaldt bare dokumentasjon og hoppet over tester og bygg. Den kan ikke publiseres.`,
    );
  }
  return latest;
}

/** True only when GitHub confirms base is an ancestor of head and every change between them is documentation. */
export async function docsOnlyBetween(github, repo, base, head) {
  let data;
  try {
    ({data} = await github.rest.repos.compareCommitsWithBasehead({...repo, basehead: `${base}...${head}`}));
  } catch (error) {
    if ([404, 422].includes(error.status)) return false;
    throw error;
  }
  if (data?.status !== 'ahead' || !Array.isArray(data.files)) return false;
  return classifyChanges(data.files, data.files.length < maxCompareFiles).docsOnly;
}

export async function isValidated(github, repo, sha, pr) {
  return Boolean(await validatedRun(github, repo, sha, pr));
}

export async function services(github, context, fetchImpl = fetch) {
  const repo = context.repo;
  if (`${repo.owner}/${repo.repo}` !== repository || context.ref !== 'refs/heads/master') {
    throw new Error('Publiseringsworkflow må kjøres fra master i riktig repo.');
  }
  const {data: master} = await github.rest.repos.getBranch({...repo, branch: 'master'});
  const getPull = async pull_number => (await github.rest.pulls.get({...repo, pull_number})).data;
  const previous = await readDeployment({
    fetch: fetchImpl,
    hasPublished: async () => {
      const deployments = await github.paginate(github.rest.repos.listDeployments, {
        ...repo,
        environment: 'github-pages',
        per_page: 100,
      });
      for (const deployment of deployments) {
        const statuses = await github.paginate(github.rest.repos.listDeploymentStatuses, {
          ...repo,
          deployment_id: deployment.id,
          per_page: 100,
        });
        if (statuses.some(status => status.state === 'success')) return true;
      }
      return false;
    },
  });
  const validations = new Map();
  const getValidatedRun = (sha, pr) => {
    const key = `${sha}/${pr}`;
    if (!validations.has(key)) validations.set(key, validatedRun(github, repo, sha, pr));
    return validations.get(key);
  };
  return {
    masterSha: master.commit.sha,
    previous,
    getPull,
    getValidatedRun,
    docsOnlySince: (base, head) => docsOnlyBetween(github, repo, base, head),
    isValidated: async (sha, pr) => Boolean(await getValidatedRun(sha, pr)),
    hasApp: async ref => {
      let content;
      try {
        content = (await github.rest.repos.getContent({...repo, ref, path: 'app-build.json'})).data;
      } catch (error) {
        if (error.status === 404) return false;
        throw error;
      }
      if (
        content.type !== 'file' ||
        content.encoding !== 'base64' ||
        JSON.parse(Buffer.from(content.content, 'base64').toString()).version !== 1
      ) {
        throw new Error('Ugyldig app-build.json.');
      }
      return true;
    },
  };
}

export async function createPlan({github, context, core, selection}) {
  const api = await services(github, context);
  // The checked-out infrastructure is exactly the validated current master, including on manual dispatch.
  if (api.masterSha !== context.sha) {
    core.setOutput('deploy', 'false');
    return;
  }
  if (context.eventName === 'workflow_run') {
    const {data: workflow} = await github.rest.actions.getWorkflow({...context.repo, workflow_id: 'ci.yml'});
    if (context.payload.workflow_run?.workflow_id !== workflow.id || workflow.path !== '.github/workflows/ci.yml') {
      throw new Error('Publiseringshendelsen kommer ikke fra ci.yml.');
    }
  }
  const plan = await planPages({...api, selection, eventName: context.eventName, event: context.payload});
  core.setOutput('deploy', Boolean(plan));
  if (!plan) {
    await core.summary.addRaw('Ingen ny publisering: publiserte utgaver er allerede oppdatert.\n').write();
    return;
  }
  core.setOutput('plan', JSON.stringify(plan));
  core.setOutput('infra', api.masterSha);
  const include = [];
  for (const [target, channel] of [
    ['production', 'production'],
    ['preview', 'test'],
  ]) {
    const source = plan.metadata[target];
    let artifactId = '',
      runId = '';
    if (source.kind === 'app') {
      const run = await api.getValidatedRun(source.sha, source.pr);
      const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
        ...context.repo,
        run_id: run.id,
        per_page: 100,
      });
      const artifact = artifacts.find(item => item.name === `validated-${channel}` && !item.expired);
      if (artifact) {
        artifactId = artifact.id;
        runId = run.id;
      }
    }
    include.push({
      target,
      channel,
      ...source,
      artifactId,
      runId,
      reuse: JSON.stringify(plan.previous?.[target]) === JSON.stringify(source),
    });
  }
  core.setOutput('matrix', JSON.stringify({include}));
  if (plan.metadata.production.sha !== plan.master) {
    core.summary.addRaw(
      `Produksjon beholder ${plan.metadata.production.sha}: bare dokumentasjon er endret frem til master ${plan.master}.\n`,
    );
  }
  await core.summary.addCodeBlock(JSON.stringify(plan.metadata, null, 2), 'json').write();
}

export async function checkCurrent({github, context, plan}) {
  await assertPlanCurrent(plan, await services(github, context));
}
