import {dropboxAdapter, type SharingConsent} from '../adapters/dropbox.ts';
import type {songStorage} from '../storage/songs.ts';
import {syncEngine, PausedSync} from './engine.ts';
import {syncStorage} from './store.ts';
import type {ApiEvent} from '../core/sync-model.ts';
import type {Conflict, SyncState} from './state.ts';
import type {PublicationChoice, PublicationResult} from './model.ts';
import {publicationError, publicationView} from './publication.ts';
import {
  DeferredSync,
  failureCodes,
  failureInfo,
  failureText,
  PublicationInProgress,
  SyncFailure,
  RetrySync,
  type FailureInfo,
} from '../core/failure.ts';
import {syncDiagnostics, type SyncLog} from './diagnostics.ts';
export function syncController(
  storage: ReturnType<typeof songStorage>,
  hooks: {
    busy(): boolean;
    downloaded(): Promise<unknown>;
    notify(): void;
    connected(): void;
    accessLost(): void;
    sharing(consent: SharingConsent): Promise<void>;
  },
) {
  const env = __APP_ENV__,
    owner = crypto.randomUUID(),
    syncStore = syncStorage(storage.database);
  const events: ApiEvent[] = [],
    operationTotals: Record<string, number> = {},
    diagnostics = syncDiagnostics(env, () => hooks.notify());
  let logging = false;
  let requestEpoch = -1,
    requestAccount: string | null = null,
    requestManual = false;
  let requestGeneration: number | null = null;
  let captureAccessLoss: ((failure: SyncFailure) => void) | undefined;
  const adapter = dropboxAdapter(
    env,
    fetch,
    async () => {
      if (navigator.onLine === false) throw new DeferredSync('connection', 'Venter på nett.');
      const allowed = () => !paused && !hooks.busy() && requestEpoch === epoch && requestAccount === account()?.id;
      if (!allowed() || !requestAccount) throw new PausedSync();
      const snapshot = await syncStore.status();
      if (!allowed() || Object.keys(snapshot.journal.sessions).length) throw new PausedSync();
      if (requestGeneration !== null && snapshot.journal.generation !== requestGeneration)
        throw new DeferredSync('changed', 'Nyere lokale endringer venter.');
      if (snapshot.journal.recoveryRequired && !requestManual)
        throw new DeferredSync('recovery', 'Lagrede endringer etter avbrudd venter på Synkroniser.');
    },
    event => {
      if (!logging) {
        operationTotals[event.operation] = (operationTotals[event.operation] ?? 0) + 1;
        events.push(event);
        if (events.length > 30) events.shift();
      }
    },
    failure => captureAccessLoss?.(failure),
  );
  let paused = false,
    epoch = 0,
    running = false,
    started = false,
    requestedManual = false,
    immediate = false,
    localPending = false;
  let changedDuringRun = false,
    recoveryRequired = false,
    workingWithDropbox = false,
    syncingPublication = false;
  let activeManual = false,
    activeEpoch = -1;
  let errorEntry: SyncLog | null = diagnostics.active();
  let state: SyncState | undefined,
    error: FailureInfo | null = errorEntry?.failure ?? null,
    popup = false,
    opening = Promise.resolve();
  let offer: (conflict: Conflict) => Promise<'local' | 'dropbox' | 'copy' | null> = async () => null;
  const channel = new BroadcastChannel(`${env.namespace}:private-sync`);
  const notify = () => {
    hooks.notify();
  };
  let ready: Promise<void>;
  if (navigator.locks) {
    let acquired!: () => void;
    ready = new Promise<void>(resolve => {
      acquired = resolve;
    });
    void navigator.locks.request(`${env.namespace}:song-owner:${owner}`, async () => {
      acquired();
      await new Promise(() => {});
    });
  } else
    ready = Promise.reject(
      new SyncFailure(
        {code: failureCodes.browser, stage: 'app.capability', action: 'update-browser'},
        'Nettleseren mangler Web Locks.',
      ),
    );
  // Observe a rejection immediately; the message is reported when startup runs.
  void ready.catch(() => {});
  function report(cause: unknown, stage: string, manual = false, accountId?: string) {
    if (cause instanceof DeferredSync) return;
    if (!accountId) {
      try {
        accountId = adapter.account()?.id;
      } catch {
        /* No account identity is copied into a report. */
      }
    }
    const result = diagnostics.record(cause, stage, manual, events, accountId, operationTotals);
    error = result.info;
    errorEntry = result.entry;
  }
  function clearFailure() {
    error = null;
    if (errorEntry) diagnostics.clear(errorEntry.id);
    errorEntry = null;
  }
  function account() {
    try {
      return adapter.account();
    } catch (cause) {
      const info = failureInfo(cause, 'app.start');
      if (error?.code !== info.code || error.stage !== info.stage) report(cause, 'app.start');
      return null;
    }
  }
  function uploadLog(accountId: string, ticket: number, manual: boolean) {
    if (!navigator.locks || navigator.onLine === false) return;
    // Do not repeat a failed connection/refresh or ignore Dropbox's rate limit
    // merely to upload diagnostics. The local report stays queued for a healthy run.
    if (
      error &&
      [failureCodes.network, failureCodes.authentication, failureCodes.permission, failureCodes.throttled].some(
        code => code === error!.code,
      )
    )
      return;
    void navigator.locks
      .request(`${env.namespace}:dropbox-sync`, async () => {
        if (ticket !== epoch || paused || hooks.busy() || account()?.id !== accountId) return;
        requestEpoch = ticket;
        requestAccount = accountId;
        requestManual = manual;
        requestGeneration = null;
        adapter.beginRun(false);
        logging = true;
        try {
          await diagnostics.flush(adapter.files, accountId);
        } finally {
          logging = false;
        }
      })
      .catch(() => {
        /* Diagnostics cannot block or change sync results. */
      });
  }
  async function refresh() {
    const user = account();
    if (user) {
      const snapshot = await syncStore.status(user.id);
      state = snapshot.state!;
      recoveryRequired = Boolean(snapshot.journal.recoveryRequired);
      localPending =
        snapshot.journal.generation !== state.localGeneration || (state.pending && !state.awaitingDownload);
    } else state = undefined;
    notify();
  }
  async function execute(manual = false, resolution?: {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'}) {
    if (manual && navigator.onLine === false) {
      notify();
      return;
    }
    if (manual) requestedManual = true;
    if (
      !started ||
      running ||
      workingWithDropbox ||
      paused ||
      hooks.busy() ||
      !account() ||
      navigator.onLine === false
    ) {
      notify();
      return;
    }
    const user = account()!,
      ticket = epoch,
      wasManual = requestedManual;
    const previousFailure = error,
      previousEntry = errorEntry;
    let completed = false;
    activeManual = wasManual;
    activeEpoch = ticket;
    requestedManual = false;
    running = true;
    changedDuringRun = false;
    error = null;
    events.length = 0;
    for (const operation of Object.keys(operationTotals)) delete operationTotals[operation];
    notify();
    const reported = new Set<unknown>();
    const failed = (cause: unknown) => {
      if (!reported.has(cause)) {
        reported.add(cause);
        report(cause, 'sync.run', wasManual, user.id);
      }
    };
    try {
      await opening;
      await ready;
      await navigator.locks.request(`${env.namespace}:dropbox-sync`, async () => {
        if (ticket !== epoch || paused || hooks.busy() || account()?.id !== user.id) throw new PausedSync();
        await recover();
        const latest = await syncStore.status();
        recoveryRequired = Boolean(latest.journal.recoveryRequired);
        if (recoveryRequired && !wasManual) return;
        requestEpoch = ticket;
        requestAccount = user.id;
        requestManual = wasManual;
        requestGeneration = latest.journal.generation;
        adapter.beginRun();
        for (let attempt = 0; attempt < 3; attempt++) {
          let idle = false;
          try {
            state = await syncEngine(syncStore, adapter.files, user.id, {
              valid: () => ticket === epoch && !paused && !hooks.busy() && account()?.id === user.id,
              changed: notify,
              failed,
              idle: () => {
                idle = true;
              },
            }).run(wasManual, resolution);
            completed = !idle;
            break;
          } catch (cause) {
            if (!(cause instanceof RetrySync)) throw cause;
            if (attempt === 2)
              throw new SyncFailure(
                {code: failureCodes.changed, stage: 'sync.run'},
                'Dropbox-versjonen endres fortsatt.',
                cause,
              );
          }
        }
      });
      localPending = Boolean(state?.pending && !state?.awaitingDownload);
      if (wasManual) {
        await hooks.downloaded();
        await refresh();
      }
      channel.postMessage('changed');
    } catch (cause) {
      if (cause instanceof DeferredSync) {
        if (wasManual && ticket === epoch && account()?.id === user.id) requestedManual = true;
        if (
          cause instanceof PublicationInProgress &&
          previousFailure?.code === failureCodes.changed &&
          previousFailure.action === 'check-move'
        )
          clearFailure();
      } else failed(cause);
      try {
        await refresh();
      } catch {
        /* Keep the actual failure visible. */
      }
    } finally {
      if (!error && account()?.id === user.id && errorEntry?.id === previousEntry?.id) {
        if (completed) clearFailure();
        else error = previousFailure;
      }
      running = false;
      activeManual = false;
      notify();
      uploadLog(user.id, ticket, wasManual);
    }
    const pendingCopy =
      state &&
      Object.entries(state.reservations).some(
        ([key, link]) => key.startsWith('copy:') && !state!.manifest.songs[link.id],
      );
    if (resolution && state?.pending && pendingCopy) {
      changedDuringRun = true;
      if (wasManual) requestedManual = true;
      else if (state.conflicts.length) immediate = true;
    }
    if (changedDuringRun && !paused && !hooks.busy()) {
      changedDuringRun = false;
      queueMicrotask(() => {
        void execute();
      });
    }
    if ((wasManual || immediate || resolution) && (!recoveryRequired || wasManual) && !paused && !hooks.busy()) {
      immediate = false;
      await conflicts(wasManual);
    }
  }
  async function conflicts(manualIntent = false) {
    if (popup || paused || hooks.busy() || running) return;
    popup = true;
    try {
      await refresh();
      const user = account();
      if (!user || Object.keys((await syncStore.status()).journal.sessions).length) return;
      const conflict = state?.conflicts[0];
      if (!conflict) return;
      const choice = await offer(conflict);
      if (choice) {
        popup = false;
        await execute(manualIntent, {conflict, choice});
      }
      // Closing defers the conflict until a later explicit Synkroniser action.
    } finally {
      popup = false;
      notify();
    }
  }
  async function manual() {
    await execute(true);
  }
  async function withDropbox<T>(
    work: (engine: ReturnType<typeof syncEngine>, canRetry: boolean) => Promise<T>,
    publication = false,
  ) {
    const user = account(),
      ticket = epoch;
    if (!user || navigator.onLine === false) throw new DeferredSync('connection', 'Dropbox er utilgjengelig.');
    if (workingWithDropbox) throw new DeferredSync('changed', 'En Dropbox-handling pågår.');
    workingWithDropbox = true;
    syncingPublication = publication;
    if (publication) notify();
    let lost: SyncFailure | undefined;
    const valid = () => ticket === epoch && !paused && !hooks.busy() && account()?.id === user.id;
    try {
      await opening;
      await ready;
      return await navigator.locks.request(`${env.namespace}:dropbox-sync`, async () => {
        if (!valid()) throw new PausedSync();
        await recover();
        const latest = await syncStore.status();
        requestEpoch = ticket;
        requestAccount = user.id;
        requestManual = true;
        requestGeneration = latest.journal.generation;
        events.length = 0;
        for (const operation of Object.keys(operationTotals)) delete operationTotals[operation];
        adapter.beginRun();
        captureAccessLoss = failure => {
          lost = failure;
        };
        try {
          for (let attempt = 0; ; attempt++) {
            try {
              const engine = syncEngine(syncStore, adapter.files, user.id, {valid, changed: () => {}});
              const result = await work(engine, attempt < 2);
              if (!valid()) throw new PausedSync();
              return result;
            } catch (error) {
              if (!(error instanceof RetrySync) || attempt === 2) throw error;
            }
          }
        } finally {
          captureAccessLoss = undefined;
        }
      });
    } finally {
      workingWithDropbox = false;
      syncingPublication = false;
      if (lost && ticket === epoch && !account()) {
        report(lost, 'sync.run', true, user.id);
        hooks.accessLost();
      }
      if (publication) notify();
      await refresh().catch(() => {});
      if (requestedManual || changedDuringRun)
        queueMicrotask(() => {
          void execute();
        });
    }
  }
  async function cachedPublication() {
    const user = account();
    return user ? publicationView(await syncStore.snapshot(user.id)) : {books: [], songs: []};
  }
  async function readPublication() {
    try {
      return {view: await withDropbox(engine => engine.refreshPublication(), true)};
    } catch (error) {
      return {view: await cachedPublication(), message: publicationError(error)};
    }
  }
  async function publish(choices: PublicationChoice[]): Promise<PublicationResult> {
    const moved = new Set<string>();
    try {
      const result = await withDropbox((engine, canRetry) => engine.executePublication(choices, canRetry, moved), true);
      channel.postMessage('changed');
      return result;
    } catch (error) {
      return {
        view: await cachedPublication(),
        completed: [],
        moved: [],
        message: publicationError(error),
        unavailable: true,
      };
    }
  }
  async function shareBook(bookId: string) {
    if (!account() || navigator.onLine === false)
      throw new DeferredSync('connection', 'Koble til Dropbox for å kopiere delingslenken.');
    if (!adapter.sharingAllowed()) {
      await adapter.connect(bookId);
      return undefined;
    }
    return withDropbox(engine => engine.withSharedFolder(bookId, adapter.sharedLink));
  }
  function localChanged() {
    adapter.cancelPending();
    if (running || workingWithDropbox) changedDuringRun = true;
    localPending = true;
    notify();
    if (!popup) void execute();
  }
  document.addEventListener('library-local-change', localChanged);
  window.addEventListener('online', () => {
    void execute();
  });
  window.addEventListener('offline', () => {
    adapter.cancelPending();
    notify();
  });
  window.addEventListener('storage', event => {
    if (event.key === `${env.namespace}:dropbox-auth-v1`) {
      epoch++;
      adapter.cancelPending();
      requestedManual = false;
      clearFailure();
      void refresh();
    }
  });
  channel.onmessage = event => {
    void refresh();
    if (event.data === 'session-ended' && requestedManual) void execute();
  };
  async function recover(restoredSongId: string | null = null) {
    const locks = await navigator.locks.query();
    await syncStore.recoverSessions(
      (locks.held ?? [])
        .map(lock => lock.name ?? '')
        .filter(name => name.startsWith(`${env.namespace}:song-owner:`))
        .map(name => name.split(':').at(-1)!),
      restoredSongId,
    );
  }
  async function start(restoredSongId: string | null = null) {
    try {
      await ready;
      await recover(restoredSongId);
      const user = account();
      // Older builds saved OAuth returns as the active sync error. Keep the
      // technical entry while restoring the status of the connected account.
      if (
        user &&
        errorEntry &&
        (errorEntry.failure.code === failureCodes.oauthReturn ||
          (errorEntry.failure.code === failureCodes.authentication &&
            (errorEntry.operationTotals?.['users/get_current_account'] ||
              errorEntry.operations.some(event => event.operation === 'users/get_current_account'))))
      )
        clearFailure();
      let first: boolean | SharingConsent;
      try {
        first = await adapter.callback();
      } catch (cause) {
        const connected = account();
        if (!connected || cause instanceof DeferredSync) throw cause;
        diagnostics.record(cause, 'dropbox.oauth', false, events, connected.id, operationTotals, false);
        started = true;
        await refresh();
        return;
      }
      started = true;
      await refresh();
      if (first === true) {
        hooks.connected();
        await execute(true);
      } else {
        if (first) {
          if (first.failure)
            diagnostics.record(first.failure, 'dropbox.oauth', false, events, account()?.id, operationTotals, false);
          await hooks.sharing(first);
          if (first.failure) return;
        }
        await execute();
      }
    } catch (cause) {
      started = true;
      report(cause, 'app.start');
      notify();
    }
  }
  function begin(songId: string, edited = false) {
    if (running && activeManual && activeEpoch === epoch) requestedManual = true;
    paused = true;
    epoch++;
    adapter.cancelPending();
    notify();
    if (!navigator.locks) return Promise.resolve();
    opening = opening
      .catch(() => {})
      .then(async () => {
        await ready;
        await syncStore.session(owner, songId, edited);
      });
    return opening;
  }
  async function end(edited: boolean) {
    if (!paused) return;
    await opening;
    if (navigator.locks) await syncStore.session(owner, null);
    paused = false;
    epoch++;
    immediate = edited;
    notify();
    channel.postMessage('session-ended');
    // Defers until navigation has actually completed and the existing leave guard has released.
    queueMicrotask(() => {
      void execute();
    });
  }
  async function disconnect() {
    const accountId = account()?.id;
    epoch++;
    requestedManual = false;
    clearFailure();
    try {
      const revoked = await adapter.disconnect();
      state = undefined;
      if (!revoked)
        report(
          new SyncFailure(
            {code: failureCodes.revoke, stage: 'dropbox.revoke', action: 'check-revoke'},
            'Dropbox bekreftet ikke tilbakekalling.',
          ),
          'app.disconnect',
          false,
          accountId,
        );
    } catch (cause) {
      state = undefined;
      report(
        new SyncFailure(
          {code: failureCodes.revoke, stage: 'dropbox.revoke', action: 'check-revoke'},
          'Dropbox bekreftet ikke tilbakekalling.',
          cause,
        ),
        'app.disconnect',
        false,
        accountId,
      );
    }
    notify();
    channel.postMessage('changed');
  }
  function status() {
    const pieces: string[] = [];
    const user = account();
    if (error) return statusFailure(error, Boolean(user));
    if (!user) return '';
    if (running) pieces.push('Synkroniserer…');
    if (pieces.length) return pieces[0];
    return state?.lastManual
      ? `Sist synkronisert: ${new Date(state.lastManual).toLocaleString('nb-NO')}`
      : 'Ikke synkronisert';
  }
  function statusFailure(failure: FailureInfo, connected: boolean) {
    return failureText(
      connected && (failure.action === 'reconnect' || failure.action === 'retry-login')
        ? {...failure, action: undefined}
        : failure,
    );
  }
  function reportText() {
    const connected = Boolean(account()),
      entry = errorEntry && (diagnostics.entry(errorEntry.id) ?? errorEntry);
    return error && entry ? `${statusFailure(error, connected)}\n\n${diagnostics.text(entry)}` : null;
  }
  return {
    start,
    begin,
    end,
    resume: () => {
      if (localPending || requestedManual || immediate) void execute();
    },
    manual,
    disconnect,
    account,
    status,
    reportText,
    readPublication,
    cachedPublication,
    publish,
    shareBook,
    running: () => running,
    syncing: () => running || syncingPublication,
    connect: async () => {
      try {
        await ready;
        clearFailure();
        await adapter.connect();
      } catch (cause) {
        report(cause, 'app.connect');
        notify();
      }
    },
    conflictHandler: (handler: typeof offer) => {
      offer = handler;
    },
  };
}
