import type {syncStorage} from './store.ts';
import type {RemoteFiles} from '../core/sync-model.ts';
import type {Conflict} from './state.ts';
import type {PublicationChoice} from './model.ts';
import {PausedSync, SyncSession, type SyncHooks} from './session.ts';
import {run} from './run.ts';
import {executePublication, refreshPublication, withSharedFolder} from './publication-flow.ts';

export {PausedSync};

/**
 * Synkmotoren for én Dropbox-konto. Hver operasjon starter en ny økt fra lagret tilstand:
 * - `run`: vanlig synkronisering (session.ts, run.ts og modulene den bruker)
 * - `refreshPublication`, `executePublication`, `withSharedFolder`: publisering (publication-flow.ts)
 */
export function syncEngine(
  storage: ReturnType<typeof syncStorage>,
  files: RemoteFiles,
  accountId: string,
  hooks: SyncHooks,
) {
  const s = new SyncSession(storage, files, accountId, hooks);
  return {
    run: (manual: boolean, resolution?: {conflict: Conflict; choice: 'local' | 'dropbox' | 'copy'}) =>
      run(s, manual, resolution),
    refreshPublication: () => refreshPublication(s),
    executePublication: (choices: PublicationChoice[], retryConflicts?: boolean, confirmedMoves?: Set<string>) =>
      executePublication(s, choices, retryConflicts, confirmedMoves),
    withSharedFolder: (
      localBookId: string,
      link: (folder: {id: string; path: string}, verifyTarget: () => Promise<void>) => Promise<string>,
    ) => withSharedFolder(s, localBookId, link),
  };
}
