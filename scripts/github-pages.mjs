import {repository, readDeployment, planPages, assertPlanCurrent} from './pages-plan.mjs';

// The workflow's identity and source are checked through Actions, never by a check name alone.
export async function isValidated(github, repo, sha, pr) {
  const {data: workflow} = await github.rest.actions.getWorkflow({...repo, workflow_id: 'ci.yml'});
  if (workflow.path !== '.github/workflows/ci.yml' || workflow.state !== 'active') return false;
  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    ...repo, workflow_id: workflow.id, head_sha: sha, event: pr === null ? 'push' : 'pull_request', per_page: 100,
  });
  const matches = runs.filter(run => run.workflow_id === workflow.id && run.path === workflow.path &&
    run.head_sha === sha && run.repository?.full_name === repository && run.head_repository?.full_name === repository &&
    run.event === (pr === null ? 'push' : 'pull_request') &&
    (pr === null ? run.head_branch === 'master' : run.pull_requests?.some(pull =>
      pull.number === pr && pull.head?.sha === sha && pull.base?.ref === 'master')));
  const latest = matches.sort((a, b) => b.id - a.id)[0];
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') return false;
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {...repo, run_id: latest.id, filter: 'latest', per_page: 100});
  return jobs.some(job => job.name === 'validate' && job.conclusion === 'success' && job.status === 'completed');
}

export async function services(github, context, fetchImpl = fetch) {
  const repo = context.repo;
  if (`${repo.owner}/${repo.repo}` !== repository || context.ref !== 'refs/heads/master') {
    throw new Error('Publiseringsworkflow må kjøres fra master i riktig repo.');
  }
  const {data: master} = await github.rest.repos.getBranch({...repo, branch: 'master'});
  const getPull = async pull_number => (await github.rest.pulls.get({...repo, pull_number})).data;
  const previous = await readDeployment({fetch: fetchImpl, hasPublished: async () => {
    const deployments = await github.paginate(github.rest.repos.listDeployments, {...repo, environment: 'github-pages', per_page: 100});
    for (const deployment of deployments) {
      const statuses = await github.paginate(github.rest.repos.listDeploymentStatuses, {...repo, deployment_id: deployment.id, per_page: 100});
      if (statuses.some(status => status.state === 'success')) return true;
    }
    return false;
  }});
  return {masterSha: master.commit.sha, previous, getPull,
    isValidated: (sha, pr) => isValidated(github, repo, sha, pr),
    hasApp: async ref => {
      let content;
      try { content = (await github.rest.repos.getContent({...repo, ref, path: 'app-build.json'})).data; }
      catch (error) { if (error.status === 404) return false; throw error; }
      if (content.type !== 'file' || content.encoding !== 'base64' ||
          JSON.parse(Buffer.from(content.content, 'base64').toString()).version !== 1) {
        throw new Error('Ugyldig app-build.json.');
      }
      return true;
    },
  };
}

export async function createPlan({github, context, core, selection}) {
  const api = await services(github, context);
  // The checked-out infrastructure is exactly the validated current master, including on manual dispatch.
  if (api.masterSha !== context.sha) { core.setOutput('deploy', 'false'); return; }
  if (context.eventName === 'workflow_run') {
    const {data: workflow} = await github.rest.actions.getWorkflow({...context.repo, workflow_id: 'ci.yml'});
    if (context.payload.workflow_run?.workflow_id !== workflow.id || workflow.path !== '.github/workflows/ci.yml') {
      throw new Error('Publiseringshendelsen kommer ikke fra ci.yml.');
    }
  }
  const plan = await planPages({...api, selection, eventName: context.eventName, event: context.payload});
  core.setOutput('deploy', Boolean(plan));
  if (!plan) return;
  core.setOutput('plan', JSON.stringify(plan));
  core.setOutput('infra', api.masterSha);
  core.setOutput('matrix', JSON.stringify({include: [
    {target: 'production', channel: 'production', ...plan.metadata.production},
    {target: 'preview', channel: 'test', ...plan.metadata.preview},
  ]}));
  await core.summary.addCodeBlock(JSON.stringify(plan.metadata, null, 2), 'json').write();
}

export async function checkCurrent({github, context, plan}) {
  await assertPlanCurrent(plan, await services(github, context));
}
