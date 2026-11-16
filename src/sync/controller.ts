import {dropboxAdapter} from '../adapters/dropbox.ts';
import type {songStorage} from '../storage/songs.ts';
import {syncEngine, PausedSync} from './engine.ts';
import type {Conflict, SyncState} from './model.ts';
export function syncController(storage: ReturnType<typeof songStorage>, hooks: {busy(): boolean; downloaded(): Promise<unknown>; notify(): void; connected(): void}) {
  const env = __APP_ENV__, owner = crypto.randomUUID();
  let requestEpoch = -1, requestAccount: string | null = null, requestManual = false;
  const adapter = dropboxAdapter(env, fetch, async () => {
    const allowed = () => !paused && !hooks.busy() && requestEpoch === epoch && requestAccount === account()?.id;
    if (!allowed() || !requestAccount) throw new PausedSync();
    const snapshot = await storage.sync.snapshot(requestAccount);
    if (!allowed() || Object.keys(snapshot.journal.sessions).length) throw new PausedSync();
    if (snapshot.journal.recoveryRequired && !requestManual) throw new Error('Lagrede endringer etter avbrudd venter på Synkroniser.');
  });
  let paused = false, epoch = 0, running = false, started = false, requestedManual = false, immediate = false, localPending = false;
  let changedDuringRun = false, recoveryRequired = false;
  let state: SyncState | undefined, error = '', popup = false, opening = Promise.resolve();
  let offer: (conflict: Conflict) => Promise<'local' | 'dropbox' | 'copy' | null> = async () => null;
  const channel = new BroadcastChannel(`${env.namespace}:private-sync`);
  const notify = () => {hooks.notify();};
  let ready: Promise<void>;
  if (navigator.locks) {
    let acquired!: () => void;
    ready = new Promise<void>(resolve => {acquired = resolve;});
    void navigator.locks.request(`${env.namespace}:song-owner:${owner}`, async () => {acquired(); await new Promise(() => {});});
  } else ready = Promise.reject(new Error('Nettleseren støtter ikke sikker samordning mellom faner. Dropbox er pauset; lokal bruk fungerer.'));
  // Observe a rejection immediately; the message is reported when startup runs.
  void ready.catch(() => {});
  function account() {try {return adapter.account();} catch (cause) {error = cause instanceof Error ? cause.message : 'Dropbox-tilkoblingen er utilgjengelig.'; return null;}}
  async function refresh() {
    const user = account(); if (user) {const snapshot = await storage.sync.snapshot(user.id);state = snapshot.state;recoveryRequired = Boolean(snapshot.journal.recoveryRequired);localPending = snapshot.journal.generation !== state.localGeneration || state.pending && !state.awaitingDownload;} else state = undefined;
    notify();
  }
  async function execute(manual = false, resolution?: {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'}) {
    if (manual) requestedManual = true;
    if (!started || running || paused || hooks.busy() || !account()) {notify(); return;}
    const user = account()!, ticket = epoch, wasManual = requestedManual;
    requestedManual = false; running = true; changedDuringRun = false; error = ''; notify();
    try {
      await opening; await ready;
      await navigator.locks.request(`${env.namespace}:dropbox-sync`, async () => {
        if (ticket !== epoch || paused || hooks.busy() || account()?.id !== user.id) throw new PausedSync();
        await recover();
        const latest = await storage.sync.snapshot(user.id); recoveryRequired = Boolean(latest.journal.recoveryRequired);
        if (recoveryRequired && !wasManual) return;
        requestEpoch = ticket; requestAccount = user.id; requestManual = wasManual;
        state = await syncEngine(storage.sync, adapter.files, user.id, {valid: () => ticket === epoch && !paused && !hooks.busy() && account()?.id === user.id, changed: notify}).run(wasManual, resolution);
      });
      localPending = Boolean(state?.pending && !state?.awaitingDownload);
      if (wasManual) {await hooks.downloaded(); await refresh();}
      channel.postMessage('changed');
    } catch (cause) {
      if (cause instanceof PausedSync && wasManual) requestedManual = true;
      error = cause instanceof Error ? cause.message : 'Synkronisering feilet. Lokale data er beholdt.';
      try {await refresh();} catch { /* Keep the actual failure visible. */ }
    } finally {running = false; notify();}
    if (resolution?.choice === 'copy' && state?.pending) changedDuringRun = true;
    if (changedDuringRun && !paused && !hooks.busy()) {changedDuringRun = false; queueMicrotask(() => {void execute();});}
    if ((wasManual || immediate) && (!recoveryRequired || wasManual) && !paused && !hooks.busy()) {immediate = false; await conflicts();}
  }
  async function conflicts() {
    if (popup || paused || hooks.busy() || running) return;
    popup = true;
    try {
      await refresh();
      const user = account(); if (!user || Object.keys((await storage.sync.snapshot(user.id)).journal.sessions).length) return;
      const conflict = state?.conflicts[0]; if (!conflict) return;
      const choice = await offer(conflict);
      if (choice) {popup = false; await execute(true, {conflict, choice});}
      // Closing defers the conflict until a later explicit Synkroniser action.
    } finally {popup = false; notify();}
  }
  async function manual() {
    if (state?.conflicts.length && !paused && !hooks.busy()) await conflicts(); else await execute(true);
  }
  function localChanged() {if (running) changedDuringRun = true; localPending = true; notify(); if (!popup) void execute();}
  document.addEventListener('library-local-change', localChanged);
  window.addEventListener('online', () => {void execute();});
  window.addEventListener('storage', event => {if (event.key === `${env.namespace}:dropbox-auth-v1`) {epoch++; void refresh();}});
  channel.onmessage = event => {void refresh();if(event.data === 'session-ended' && requestedManual) void execute();};
  async function recover(restoredSongId: string | null = null) {
    const locks = await navigator.locks.query();
    await storage.sync.recoverSessions((locks.held ?? []).map(lock => lock.name ?? '').filter(name => name.startsWith(`${env.namespace}:song-owner:`)).map(name => name.split(':').at(-1)!), restoredSongId);
  }
  async function start(restoredSongId: string | null = null) {
    try {
      await ready;
      await recover(restoredSongId);
      const first = await adapter.callback(); started = true; await refresh();
      if (first) {hooks.connected(); await execute(true);} else await execute();
    } catch (cause) {started = true; error = cause instanceof Error ? cause.message : 'Dropbox-tilkoblingen feilet.'; notify();}
  }
  function begin(songId: string, edited = false) {
    paused = true; epoch++; notify();
    if (!navigator.locks) return Promise.resolve();
    opening = opening.catch(() => {}).then(async () => {await ready; await storage.sync.session(owner, songId, edited);});
    return opening;
  }
  async function end(edited: boolean) {
    if (!paused) return;
    await opening; if (navigator.locks) await storage.sync.session(owner, null); paused = false; epoch++; immediate = edited; notify();channel.postMessage('session-ended');
    // Defers until navigation has actually completed and the existing leave guard has released.
    queueMicrotask(() => {void execute();});
  }
  async function disconnect() {
    epoch++; requestedManual = false;
    try {const revoked = await adapter.disconnect(); state = undefined; error = revoked ? '' : 'Frakoblet lokalt. Dropbox kunne ikke bekrefte tilbakekalling av tilgangen.';}
    catch {state = undefined; error = 'Frakoblet lokalt. Dropbox kunne ikke bekrefte tilbakekalling av tilgangen.';}
    notify(); channel.postMessage('changed');
  }
  function status() {
    const pieces: string[] = [];
    if (!account()) return error;
    if (running) pieces.push('Synkroniserer…');
    if (paused) pieces.push(requestedManual ? 'Synkronisering fortsetter når sangen er forlatt.' : 'Synkronisering er pauset mens en sang er åpen.');
    if (error || state?.error) pieces.push(error || state!.error!);
    if (state?.conflicts.length) pieces.push(`${state.conflicts.length} uløste konflikter. Trykk Synkroniser for å velge versjon.`);
    if (state?.awaitingDownload) pieces.push('Dropbox har endringer. Trykk Synkroniser for å hente dem.');
    if (recoveryRequired) pieces.push('Lagrede endringer etter avbrudd venter på Synkroniser.');
    if (localPending || state?.pending && !state?.awaitingDownload) pieces.push('Endringer venter på opplasting.');
    if (state?.lastManual) pieces.push(`Sist synkronisert: ${new Date(state.lastManual).toLocaleString('nb-NO')}`);
    return pieces.join(' ') || 'Ingen manuell synkronisering ennå.';
  }
  return {start, begin, end, resume: () => {if (localPending || requestedManual || immediate) void execute();}, manual, disconnect, account, status, running: () => running, connect: async () => {await ready; await adapter.connect();}, conflictHandler: (handler: typeof offer) => {offer = handler;}};
}
