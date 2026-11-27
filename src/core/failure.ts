/** Stable, searchable codes. User content and API messages never enter diagnostics. */
export const failureCodes = {
  unexpected: 'SYNC-001',
  network: 'SYNC-002',
  request: 'SYNC-003',
  authentication: 'SYNC-004',
  permission: 'SYNC-005',
  changed: 'SYNC-006',
  throttled: 'SYNC-007',
  response: 'SYNC-008',
  folderResponse: 'SYNC-009',
  folderOccupied: 'SYNC-010',
  missingFolder: 'SYNC-011',
  missingFile: 'SYNC-012',
  manifest: 'SYNC-013',
  personal: 'SYNC-014',
  original: 'SYNC-015',
  bookChanges: 'SYNC-016',
  storage: 'SYNC-017',
  browser: 'SYNC-018',
  oauthReturn: 'SYNC-019',
  oauthResponse: 'SYNC-020',
  configuration: 'SYNC-021',
  credentials: 'SYNC-022',
  // SYNC-023 is retired and never reused.
  bookName: 'SYNC-024',
} as const;
export type FailureCode = (typeof failureCodes)[keyof typeof failureCodes];
export const userActions = {
  'mutation-state': 'Synkmetadata er uventet. Behold lokale data og kopier feilloggen for feilsøking.',
  'check-move': 'Flyttingen kunne ikke bekreftes. Kontroller flyttingen i Dropbox og trykk Synkroniser.',
  'check-folders': 'Mappeopprettelsen kunne ikke bekreftes. Kontroller mappene i Dropbox og trykk Synkroniser.',
  reconnect: 'Koble til Dropbox på nytt.',
  'retry-login': 'Start tilkoblingen på nytt med Koble til Dropbox.',
  'open-app': 'Åpne appen fra den faste appadressen og prøv igjen.',
  'book-names': 'Gi sangbøkene ulike navn og trykk Synkroniser.',
  'remote-book-names': 'Gi sangbokmappene i Dropbox gyldige og ulike navn og trykk Synkroniser.',
  'free-space': 'Frigjør plass på enheten og prøv igjen.',
  'folder-layout':
    'Kontroller mappene i Dropbox. En fil står på en nødvendig mappeplassering; flytt filen eller endre filnavnet og prøv igjen.',
  'close-tabs': 'Lukk andre faner med appen og prøv igjen.',
  'update-browser': 'Åpne appen i en oppdatert nettleser og prøv igjen.',
} as const;
export type RateLimitReason = 'too_many_requests' | 'too_many_write_operations' | 'unknown';
export interface RateInfo {
  limitReason?: RateLimitReason;
  retryAfterMs?: number;
}
export interface FailureInfo extends RateInfo {
  code: FailureCode;
  stage: string;
  status?: number;
  action?: keyof typeof userActions;
}
export class SyncFailure extends Error {
  readonly info: FailureInfo;
  constructor(info: FailureInfo, message: string, cause?: unknown) {
    super(message, {cause});
    this.name = 'SyncFailure';
    this.info = info;
  }
}
/** A terminal server job failed; a new plan may be computed after refresh. */
export class BatchJobFailed extends SyncFailure {}
/** The status endpoint could not report the outcome of an accepted batch. */
export class BatchStatusUnconfirmed extends SyncFailure {}
/** Dropbox rejected the launch with HTTP 429. Revalidate before submitting again. */
export class BatchRateRejected extends SyncFailure {}
/** A batch request failed before its destination endpoint was called. */
export class UnsentBatch extends SyncFailure {
  constructor(error: SyncFailure) {
    super(error.info, error.message, error);
  }
}
/** The namespace plan met a delay or definitive rejection before acceptance. */
export class NamespacePlanNeedsRefresh extends UnsentBatch {
  constructor() {
    super(
      new SyncFailure(
        {code: failureCodes.changed, stage: 'sync.namespace'},
        'Batchplanen må kontrolleres på nytt etter venting.',
      ),
    );
  }
}
/** Normal interruption; never reported or logged as a sync failure. */
export class DeferredSync extends Error {
  readonly reason: 'session' | 'changed' | 'recovery' | 'connection' | 'remote';
  constructor(reason: DeferredSync['reason'], message: string) {
    super(message);
    this.name = 'DeferredSync';
    this.reason = reason;
  }
}
/** Dropbox is still processing a publication that already has a job ID. */
export class PublicationInProgress extends DeferredSync {
  constructor() {
    super('remote', 'Dropbox-jobben er ikke ferdig.');
  }
}
/** A post-response guard interrupted an already sent batch with an uncertain
 * response. Unlike preflight/definitive 4xx, this cannot authorize replay. */
export class SubmittedBatchInterruption extends DeferredSync {}
export class RetrySync extends DeferredSync {
  constructor() {
    super('changed', 'Dropbox-versjonen endret seg under overføringen.');
  }
}
export function failureInfo(error: unknown, stage = 'sync'): FailureInfo {
  return error instanceof SyncFailure ? error.info : {code: failureCodes.unexpected, stage};
}
export function failureText(info: FailureInfo) {
  return `Synkronisering feilet (Feilkode ${info.code})${info.action ? `. ${userActions[info.action]}` : ''}`;
}
