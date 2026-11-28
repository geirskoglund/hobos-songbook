import type {AppEnvironment} from '../environment.ts';
import type {ApiEvent} from '../core/sync-model.ts';

/**
 * Temporary timing log for the test address: where a sync run spends its time.
 * It holds operation names, statuses and milliseconds only, never paths or
 * content, and it is never uploaded, so measuring adds no Dropbox calls.
 */
interface Step {
  at: number;
  ms: number;
  name: string;
  status?: number;
}
interface TimingRun {
  started: string;
  manual: boolean;
  outcome: 'ok' | 'failed' | 'deferred';
  totalMs: number;
  steps: Step[];
}
const runLimit = 10,
  stepLimit = 300;

export function syncTiming(env: AppEnvironment, now: () => number = () => performance.now()) {
  const enabled = env.channel === 'test',
    key = `${env.namespace}:sync-timing-v1`;
  let runs: TimingRun[] = [],
    current: {start: number; run: TimingRun; marks: Map<string, number>} | null = null;
  if (enabled) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '[]');
      if (Array.isArray(saved)) runs = saved.slice(-runLimit);
    } catch {
      /* A missing timing log is not an error. */
    }
  }
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify(runs));
    } catch {
      /* Timing never affects sync. */
    }
  };
  const push = (step: Step) => {
    if (current && current.run.steps.length < stepLimit) current.run.steps.push(step);
  };
  return {
    enabled,
    begin(manual: boolean) {
      if (!enabled) return;
      current = {
        start: now(),
        marks: new Map(),
        run: {started: new Date().toISOString(), manual, outcome: 'ok', totalMs: 0, steps: []},
      };
    },
    /** A Dropbox call; the adapter reports it when the reply has arrived. */
    request(event: ApiEvent) {
      if (!current) return;
      const ms = Math.round(event.durationMs);
      push({at: Math.max(0, Math.round(now() - current.start - ms)), ms, name: event.operation, status: event.status});
    },
    /** Start or end a named part of the run, such as waiting for the lock. */
    phase(name: string) {
      if (!current) return;
      const at = now() - current.start,
        begun = current.marks.get(name);
      if (begun === undefined) current.marks.set(name, at);
      else {
        current.marks.delete(name);
        push({at: Math.round(begun), ms: Math.round(at - begun), name: `[${name}]`});
      }
    },
    end(outcome: TimingRun['outcome']) {
      if (!current) return;
      const run = current.run;
      run.outcome = outcome;
      run.totalMs = Math.round(now() - current.start);
      run.steps.sort((a, b) => a.at - b.at);
      current = null;
      runs = [...runs, run].slice(-runLimit);
      save();
    },
    has: () => runs.length > 0,
    text(): string {
      return [
        `Synklogg ${env.name} ${env.sha.slice(0, 7)}${env.pr ? ` PR ${env.pr}` : ''}`,
        ...runs.map(timingText),
      ].join('\n\n');
    },
  };
}

function timingText(run: TimingRun) {
  const calls = run.steps.filter(step => !step.name.startsWith('[')),
    callMs = calls.reduce((sum, step) => sum + step.ms, 0),
    totals = new Map<string, {count: number; ms: number}>();
  for (const call of calls) {
    const total = totals.get(call.name) ?? {count: 0, ms: 0};
    total.count++;
    total.ms += call.ms;
    totals.set(call.name, total);
  }
  return [
    `${run.started} ${run.manual ? 'manuell' : 'automatisk'} ${run.outcome}: ${run.totalMs} ms, ` +
      `${calls.length} kall ${callMs} ms, utenom kall ${run.totalMs - callMs} ms`,
    ...[...totals].map(([name, total]) => `  ${name}: ${total.count} kall, ${total.ms} ms`),
    '  Tidslinje (start ms, varighet ms):',
    ...run.steps.map(
      step => `  ${step.at} +${step.ms} ${step.name}${step.status === undefined ? '' : ` ${step.status}`}`,
    ),
  ].join('\n');
}
