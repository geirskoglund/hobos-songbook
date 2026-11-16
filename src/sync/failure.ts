/** Stable, searchable codes. User content and API messages never enter diagnostics. */
export const failureCodes = {
  unexpected: 'SYNC-001', network: 'SYNC-002', request: 'SYNC-003', authentication: 'SYNC-004',
  permission: 'SYNC-005', changed: 'SYNC-006', throttled: 'SYNC-007', response: 'SYNC-008',
  folderResponse: 'SYNC-009', folderOccupied: 'SYNC-010', missingFolder: 'SYNC-011',
  missingFile: 'SYNC-012', manifest: 'SYNC-013', personal: 'SYNC-014', original: 'SYNC-015',
  bookChanges: 'SYNC-016', storage: 'SYNC-017', browser: 'SYNC-018',
  oauthReturn: 'SYNC-019', oauthResponse: 'SYNC-020', configuration: 'SYNC-021',
  credentials: 'SYNC-022', revoke: 'SYNC-023', bookName: 'SYNC-024',
} as const;
export type FailureCode = typeof failureCodes[keyof typeof failureCodes];
export const userActions = {
  reconnect: 'Koble til Dropbox på nytt.',
  'retry-login': 'Start tilkoblingen på nytt med Koble til Dropbox.',
  'open-app': 'Åpne appen fra den faste appadressen og prøv igjen.',
  'book-names': 'Gi sangbøkene ulike navn og trykk Synkroniser.',
  'remote-book-names': 'Gi sangbokmappene i Dropbox gyldige og ulike navn og trykk Synkroniser.',
  'free-space': 'Frigjør plass på enheten og prøv igjen.',
  'folder-layout': 'Kontroller mappene i Dropbox. En fil står på en nødvendig mappeplassering; flytt filen eller endre filnavnet og prøv igjen.',
  'close-tabs': 'Lukk andre faner med appen og prøv igjen.',
  'update-browser': 'Åpne appen i en oppdatert nettleser og prøv igjen.',
  'check-revoke': 'Du er koblet fra lokalt. Kontroller appens tilgang under tilkoblede apper i Dropbox.',
} as const;
export type RateLimitReason='too_many_requests'|'too_many_write_operations'|'unknown';
export interface RateInfo {limitReason?:RateLimitReason;retryAfterMs?:number}
export interface FailureInfo extends RateInfo {code: FailureCode; stage: string; status?: number; action?: keyof typeof userActions}
export class SyncFailure extends Error {
  readonly info: FailureInfo;
  constructor(info: FailureInfo, message: string, cause?: unknown) {super(message, {cause}); this.name = 'SyncFailure'; this.info = info;}
}
/** Normal interruption; never reported or logged as a sync failure. */
export class DeferredSync extends Error {
  readonly reason: 'session' | 'changed' | 'recovery' | 'connection' | 'remote';
  constructor(reason: DeferredSync['reason'], message: string) {super(message); this.name = 'DeferredSync'; this.reason = reason;}
}
export class RetrySync extends DeferredSync {constructor(){super('changed','Dropbox-versjonen endret seg under overføringen.');}}
export function failureInfo(error: unknown, stage = 'sync'): FailureInfo {
  return error instanceof SyncFailure ? error.info : {code: failureCodes.unexpected, stage};
}
export function failureText(info: FailureInfo) {
  return `Synkronisering feilet (Feilkode ${info.code})${info.action ? `. ${userActions[info.action]}` : ''}`;
}
