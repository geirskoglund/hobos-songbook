import type {AppEnvironment} from '../environment.ts';
import type {RemoteFiles, RemoteEntry, UploadResult, ApiEvent, ApiContext, SharedEntry} from '../core/sync-model.ts';
import {appFolder, libraryPath, mutationPath} from '../core/paths.ts';
import {checkSize, textBytes, maxFileBytes, maxBatchAppendBytes, SkippedFile} from '../core/limits.ts';
import {
  DeferredSync,
  SubmittedBatchInterruption,
  failureCodes,
  SyncFailure,
  UnsentBatch,
  NamespacePlanNeedsRefresh,
  BatchStatusUnconfirmed,
} from '../core/failure.ts';
import {DropboxError, dropboxRate} from './dropbox-rate.ts';
import type {ImportTest} from '../domain/shared-import.ts';
import {
  changeEntry,
  displayPath,
  errorSummary,
  field,
  fileValue,
  list,
  moveReply,
  namespaceReply,
  oneOf,
  tag,
  text,
  tokenReply,
} from './dropbox-reply.ts';
export {DropboxError} from './dropbox-rate.ts';
export const requiredScopes = ['account_info.read', 'files.metadata.read', 'files.content.read', 'files.content.write'];
export const sharingScopes = ['sharing.read', 'sharing.write'];
export function dropboxConfig(channel: AppEnvironment['channel']) {
  return {
    key: channel === 'production' ? '9hivdq3nxrgtquz' : 'le5cddh388klcjz',
    redirect: `https://geirskoglund.github.io/hobos-songbook/${channel === 'production' ? 'app' : 'test'}/`,
  };
}
interface Credentials {
  version: 1;
  accountId: string;
  name: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expires: number;
  scopes?: string[];
}
interface Pending {
  state: string;
  verifier: string;
  redirect: string;
  created: number;
  sharing?: {accountId: string; bookId: string};
}
export interface SharingConsent {
  /** The songbook whose link was requested, or empty when consent was asked for an import. */
  bookId: string;
  authorized: boolean;
  failure?: unknown;
}
interface RequestOptions {
  finishMove?: boolean;
  releaseFence?: boolean;
  namespacePlanAttempt?: number;
  beforeSend?: () => void | Promise<void>;
  immediate?: boolean;
}
interface RejectedToken {
  grant: Credentials;
  accessToken: string;
  guard: () => Promise<void>;
}
const apiArg = (value: unknown) =>
  JSON.stringify(value).replace(
    /[^\u0000-\u007f]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
const contentRoutes = new Set([
  'files/download',
  'sharing/get_shared_link_file',
  'files/upload',
  'files/upload_session/start',
  'files/upload_session/append_batch',
]);
const moveReceiptReads = new Set([
  'files/list_folder',
  'files/list_folder/continue',
  'files/get_metadata',
  'oauth2/token',
]);
const batchLaunchRoutes = new Set(['files/move_batch_v2', 'files/delete_batch', 'files/create_folder_batch']);
const batchStatusStages = new Map([
  ['files/move_batch/check_v2', 'dropbox.move-batch'],
  ['files/delete_batch/check', 'dropbox.delete-batch'],
  ['files/create_folder_batch/check', 'dropbox.folders-batch'],
]);
const random = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
export async function pkceChallenge(verifier: string) {
  return btoa(
    String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
export function dropboxAdapter(
  env: AppEnvironment,
  request: typeof fetch = fetch,
  beforeRequest: () => void | Promise<void> = () => {},
  observe: (event: ApiEvent) => void = () => {},
  accessLost: (failure: SyncFailure) => void = () => {},
) {
  const config = dropboxConfig(env.channel),
    authKey = `${env.namespace}:dropbox-auth-v1`,
    pendingKey = `${env.namespace}:dropbox-pkce-v1`;
  let invalidated = 0,
    finishingMove = 0;
  const rate = dropboxRate(env.namespace, () => credentials()?.accountId ?? null, beforeRequest, observe);
  function deadline() {
    if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(30000);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30000);
    return controller.signal;
  }
  const resource = (path: string): ApiContext['resource'] =>
    /^\/\.app\/songs\//i.test(path)
      ? 'personal'
      : /^\/\.app\/uploads\//i.test(path)
        ? 'staging'
        : path.startsWith(appFolder + '/')
          ? 'control'
          : /^\/Songbooks\/[^/]+\/(Private|Shared|Import)\//i.test(path)
            ? 'content'
            : 'other';
  function loseAccess(stage: string, status: number): never {
    const failure = new SyncFailure(
      {code: failureCodes.authentication, stage, status, action: 'reconnect'},
      'Dropbox avviste den lagrede tilgangen.',
    );
    localStorage.removeItem(authKey);
    accessLost(failure);
    throw failure;
  }
  async function send(
    operation: string,
    source: RequestInit | (() => RequestInit),
    transform?: (response: Response) => Promise<Response>,
    context: ApiContext = {},
    options: RequestOptions = {},
  ) {
    // OAuth exchange/account lookup use their own temporary grant. Only file
    // and sharing routes are allowed to recover the saved connection.
    const grant = /^(files|sharing)\//.test(operation) ? credentials() : null;
    let details: ApiContext = context;
    let rejectedToken: string | undefined;
    let renewedAfterRejection = false;
    async function recoverAuthentication(response: Response, guard: () => Promise<void>) {
      if (!grant || !rejectedToken) return false;
      const problem: unknown = await response
        .clone()
        .json()
        .catch(() => null);
      const reason = tag(problem, 'error') ?? errorSummary(problem)?.split('/')[0];
      if (reason !== 'invalid_access_token' && (reason !== 'expired_access_token' || renewedAfterRejection))
        return false;
      try {
        await guard();
        const saved = credentials();
        if (!sameGrant(grant, saved)) throw new DeferredSync('connection', 'Dropbox-tilkoblingen er endret.');
        if (reason === 'invalid_access_token') {
          if (saved.accessToken !== rejectedToken)
            throw new DeferredSync('changed', 'Dropbox-tilgangen er allerede fornyet.');
          loseAccess('dropbox.request', response.status);
        }
        await access(undefined, options.releaseFence, {grant, accessToken: rejectedToken, guard});
      } catch (error) {
        if (batchLaunchRoutes.has(operation) && error instanceof SyncFailure) throw new UnsentBatch(error);
        throw error;
      }
      // Recheck the aggregate namespace plan after a definitively rejected
      // launch, including folder parent identities and empty delete targets.
      if (options.namespacePlanAttempt !== undefined) throw new NamespacePlanNeedsRefresh();
      renewedAfterRejection = true;
      return true;
    }
    return rate.send(
      operation,
      async (attempt, check) => {
        const init = typeof source === 'function' ? source() : source;
        if (
          typeof init.body === 'string' &&
          init.headers &&
          Object.entries(init.headers).some(
            ([key, value]) => key.toLowerCase() === 'content-type' && value === 'application/json',
          )
        )
          try {
            const body: unknown = JSON.parse(init.body),
              count = field(body, 'entries', 'length') ?? field(body, 'paths', 'length') ?? field(body, 'num_sessions');
            if (typeof count === 'number' && Number.isInteger(count)) details = {...details, batchSize: count};
          } catch {
            /* Never include request contents in diagnostics. */
          }
        let headers = init.headers;
        if (attempt || renewedAfterRejection)
          try {
            if (grant) {
              if (!sameGrant(grant, credentials()))
                throw new DeferredSync('connection', 'Dropbox-tilkoblingen er endret.');
              headers = {
                ...(headers as Record<string, string>),
                Authorization: `Bearer ${await access(undefined, options.releaseFence)}`,
              };
            }
            await check();
          } catch (error) {
            if (batchLaunchRoutes.has(operation) && error instanceof SyncFailure) throw new UnsentBatch(error);
            throw error;
          }
        if (options.beforeSend) {
          const accountId = credentials()?.accountId;
          await options.beforeSend();
          // The final metadata request can itself have renewed the bearer.
          const verified = credentials();
          if (!verified?.accessToken || verified.accountId !== accountId || (grant && !sameGrant(grant, verified)))
            throw new DeferredSync('connection', 'Dropbox-tilkoblingen er endret.');
          headers = {...(headers as Record<string, string>), Authorization: `Bearer ${verified.accessToken}`};
        }
        details = {...details, requestId: undefined};
        const response = await request(
          `https://${contentRoutes.has(operation) ? 'content' : 'api'}.dropboxapi.com/${operation === 'oauth2/token' ? '' : '2/'}${operation}`,
          {...init, headers, signal: init.signal ?? deadline()},
        );
        if (grant && response.status === 401)
          rejectedToken = new Headers(headers).get('Authorization')?.slice('Bearer '.length);
        details = {...details, requestId: response.headers.get('X-Dropbox-Request-Id') ?? undefined};
        if (transform)
          try {
            return await transform(response);
          } catch (error) {
            Object.defineProperty(response, 'transformFailure', {value: error});
          }
        return response;
      },
      () => details,
      {
        recoverAuthentication: grant ? recoverAuthentication : undefined,
        namespacePlanAttempt: options.namespacePlanAttempt,
        immediate: options.immediate,
        settlement: options.releaseFence
          ? 'fence-release'
          : finishingMove > 0 && (options.finishMove || moveReceiptReads.has(operation))
            ? 'move-receipt'
            : undefined,
      },
    );
  }
  async function json(response: Response, stage = 'dropbox.request'): Promise<unknown> {
    try {
      const value: unknown = await response.json();
      return value;
    } catch (cause) {
      throw new SyncFailure(
        {
          code: cause instanceof SyntaxError ? failureCodes.response : failureCodes.network,
          stage,
          status: response.status,
        },
        'Dropbox-responsen kunne ikke leses.',
        cause,
      );
    }
  }
  function credentials(): Credentials | null {
    const raw = localStorage.getItem(authKey);
    if (!raw) return null;
    let value: Credentials;
    try {
      value = JSON.parse(raw);
    } catch (cause) {
      throw new SyncFailure(
        {code: failureCodes.credentials, stage: 'dropbox.oauth', action: 'reconnect'},
        'Ugyldig lagret tilkobling.',
        cause,
      );
    }
    if (value?.version !== 1 || !value.accountId || !value.refreshToken)
      throw new SyncFailure(
        {code: failureCodes.credentials, stage: 'dropbox.oauth', action: 'reconnect'},
        'Ugyldig lagret tilkobling.',
      );
    return value;
  }
  const sameGrant = (previous: Credentials, current: Credentials | null): current is Credentials =>
    current?.accountId === previous.accountId && current.refreshToken === previous.refreshToken;
  const account = () => {
    const value = credentials();
    return value && {id: value.accountId, name: value.name, email: value.email};
  };
  const sharingAllowed = () => {
    const scopes = credentials()?.scopes;
    return Array.isArray(scopes) && sharingScopes.every(scope => scopes.includes(scope));
  };
  async function token(body: URLSearchParams, releaseFence = false) {
    const ticket = invalidated,
      refresh = body.get('refresh_token');
    const response = await send(
      'oauth2/token',
      {method: 'POST', body, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'},
      undefined,
      {},
      {releaseFence},
    );
    if (!response.ok) {
      const problem: unknown = await response.json().catch(() => null);
      if ((response.status === 400 || response.status === 401) && field(problem, 'error') === 'invalid_grant') {
        if (refresh && ticket === invalidated && credentials()?.refreshToken === refresh)
          loseAccess('dropbox.token', response.status);
        throw new SyncFailure(
          {code: failureCodes.authentication, stage: 'dropbox.token', status: response.status},
          'Dropbox avviste tilgangen.',
        );
      }
      throw new DropboxError(response.status, 'token', 'dropbox.token');
    }
    return tokenReply(await json(response, 'dropbox.token'));
  }
  async function access(onRenew?: () => void, releaseFence = false, rejected?: RejectedToken) {
    return navigator.locks.request(`${env.namespace}:dropbox-token`, async () => {
      if (rejected) await rejected.guard();
      let value = credentials();
      if (!value || (rejected && !sameGrant(rejected.grant, value)))
        throw new DeferredSync('connection', 'Dropbox-tilkoblingen er endret.');
      if ((!rejected || value.accessToken !== rejected.accessToken) && value.expires > Date.now() + 60000)
        return value.accessToken;
      const epoch = invalidated,
        previous = value.refreshToken;
      onRenew?.();
      const next = await token(
        new URLSearchParams({grant_type: 'refresh_token', refresh_token: previous, client_id: config.key}),
        releaseFence,
      );
      if (rejected) await rejected.guard();
      value = credentials();
      if (epoch !== invalidated || value?.refreshToken !== previous)
        throw new DeferredSync('connection', 'Dropbox-tilkoblingen er endret.');
      value.accessToken = next.accessToken;
      value.expires = Date.now() + next.expiresIn * 1000;
      localStorage.setItem(authKey, JSON.stringify(value));
      return value.accessToken;
    });
  }
  /** With `bookId`, asks an existing connection for sharing consent; an empty ID means import. */
  async function connect(bookId?: string) {
    if (location.origin + location.pathname !== config.redirect)
      throw new SyncFailure(
        {code: failureCodes.configuration, stage: 'dropbox.oauth', action: 'open-app'},
        'Dropbox-tilkobling må startes fra den faste appadressen.',
      );
    const pending: Pending = {state: random(), verifier: random(), redirect: config.redirect, created: Date.now()};
    if (bookId !== undefined) {
      const current = account();
      if (!current) throw new DeferredSync('connection', 'Dropbox er frakoblet.');
      pending.sharing = {accountId: current.id, bookId};
    }
    const challenge = await pkceChallenge(pending.verifier);
    sessionStorage.setItem(pendingKey, JSON.stringify(pending));
    const url = new URL('https://www.dropbox.com/oauth2/authorize');
    // Every connection asks for sharing too, so sharing and import need no later consent.
    const scopes = [...requiredScopes, ...sharingScopes];
    url.search = new URLSearchParams({
      client_id: config.key,
      response_type: 'code',
      redirect_uri: config.redirect,
      state: pending.state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      token_access_type: 'offline',
      // Without this Dropbox may skip its approval page; a new connection always asks again.
      force_reapprove: 'true',
      scope: scopes.join(' '),
    }).toString();
    location.assign(url.href);
  }
  async function callback(): Promise<boolean | SharingConsent> {
    const url = new URL(location.href);
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) return false;
    const code = url.searchParams.get('code'),
      state = url.searchParams.get('state'),
      error = url.searchParams.get('error');
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    const raw = sessionStorage.getItem(pendingKey);
    sessionStorage.removeItem(pendingKey);
    let pending: Pending | null = null;
    try {
      pending = raw ? JSON.parse(raw) : null;
    } catch {
      /* Invalid callback state is handled below. */
    }
    if (
      !pending ||
      !state ||
      pending.state !== state ||
      !pending.verifier ||
      !Number.isFinite(pending.created) ||
      pending.redirect !== config.redirect ||
      location.origin + location.pathname !== config.redirect ||
      Date.now() - pending.created > 10 * 60 * 1000 ||
      pending.created > Date.now()
    )
      throw new SyncFailure(
        {code: failureCodes.oauthReturn, stage: 'dropbox.oauth', action: 'retry-login'},
        'Dropbox-returen er ugyldig eller utløpt.',
      );
    const sharing = pending.sharing;
    if (sharing && account()?.id !== sharing.accountId) return false;
    if (error === 'access_denied') return sharing ? {bookId: sharing.bookId, authorized: false} : false;
    try {
      if (error || !code)
        throw new SyncFailure(
          {code: failureCodes.oauthResponse, stage: 'dropbox.oauth'},
          'Dropbox returnerte ingen gyldig innloggingskode.',
        );
      const epoch = invalidated;
      const value = await token(
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: config.key,
          redirect_uri: config.redirect,
          code_verifier: pending.verifier,
        }),
      );
      const scopes = value.scopes;
      if (sharing && ![...requiredScopes, ...sharingScopes].every(scope => scopes.includes(scope))) {
        return {bookId: sharing.bookId, authorized: false};
      }
      if (!value.refreshToken || !requiredScopes.every(scope => scopes.includes(scope)))
        throw new SyncFailure(
          {code: failureCodes.permission, stage: 'dropbox.oauth'},
          'Dropbox mangler nødvendig fornybar tilgang eller nødvendige scopes.',
        );
      const response = await send('users/get_current_account', {
        method: 'POST',
        headers: {Authorization: `Bearer ${value.accessToken}`},
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw new DropboxError(response.status, 'account', 'dropbox.account');
      const user = await json(response, 'dropbox.account');
      if (epoch !== invalidated) throw new DeferredSync('connection', 'Dropbox-tilkoblingen er endret.');
      const accountId = field(user, 'account_id'),
        name = field(user, 'name', 'display_name'),
        email = field(user, 'email');
      if (
        typeof accountId !== 'string' ||
        accountId !== value.accountId ||
        typeof name !== 'string' ||
        typeof email !== 'string'
      )
        throw new SyncFailure(
          {code: failureCodes.oauthResponse, stage: 'dropbox.account'},
          'Dropbox returnerte ugyldig kontorespons.',
        );
      if (sharing && (accountId !== sharing.accountId || account()?.id !== sharing.accountId)) {
        return {bookId: sharing.bookId, authorized: false};
      }
      localStorage.setItem(
        authKey,
        JSON.stringify({
          version: 1,
          accountId,
          name,
          email,
          accessToken: value.accessToken,
          refreshToken: value.refreshToken,
          expires: Date.now() + value.expiresIn * 1000,
          scopes,
        } satisfies Credentials),
      );
      return sharing ? {bookId: sharing.bookId, authorized: true} : true;
    } catch (failure) {
      if (!sharing || failure instanceof DeferredSync) throw failure;
      return account()?.id === sharing.accountId ? {bookId: sharing.bookId, authorized: false, failure} : false;
    }
  }
  async function rpc(
    path: string,
    body: unknown,
    entryAttempt = 0,
    context: ApiContext = {},
    options: RequestOptions = {},
  ) {
    const statusStage = batchStatusStages.get(path);
    const batch = batchLaunchRoutes.has(path) || Boolean(statusStage);
    const validatePlan = options.namespacePlanAttempt !== undefined,
      waits = rate.waitCount();
    let renewed = false;
    let accessToken: string;
    try {
      await beforeRequest();
      accessToken = await access(
        validatePlan
          ? () => {
              renewed = true;
            }
          : undefined,
      );
      await beforeRequest();
    } catch (error) {
      if (batchLaunchRoutes.has(path) && error instanceof SyncFailure) throw new UnsentBatch(error);
      throw error;
    }
    // The namespace queue can refresh the whole plan before any move is sent.
    const beforeSend = validatePlan
      ? () => {
          if (renewed || rate.waitCount() !== waits) throw new NamespacePlanNeedsRefresh();
        }
      : options.beforeSend;
    const locked = (failure: unknown): boolean =>
      tag(failure) === 'too_many_write_operations' ||
      ['path', 'path_write', 'from_write', 'to', 'relocation_error', 'failed'].some(key => {
        const inner = field(failure, key);
        return Boolean(inner) && locked(inner);
      });
    const response = await send(
      path,
      {
        method: 'POST',
        headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(body),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      },
      batch
        ? async reply => {
            if (reply.status === 200) {
              const value: unknown = await reply
                .clone()
                .json()
                .catch(() => null);
              if (
                list(field(value, 'entries'))?.some(entry => locked(field(entry, 'failure'))) ||
                (tag(value) === 'failed' && locked(field(value, 'failed')))
              )
                Object.defineProperty(reply, 'entryRateAttempt', {value: entryAttempt});
            }
            return reply;
          }
        : undefined,
      context,
      {...options, beforeSend},
    );
    // Successful transport receipts must reach the account/operation journal
    // before a generation/session guard discards the local continuation.
    if (!batch || !response.ok)
      try {
        await beforeRequest();
      } catch (error) {
        const rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
        if (batch && !rejected && error instanceof DeferredSync)
          throw new SubmittedBatchInterruption(error.reason, error.message);
        throw error;
      }
    if (!response.ok) {
      const problem: unknown = await response.json().catch(() => ({}));
      const summary = errorSummary(problem) ?? 'request';
      const reason = tag(problem, 'error');
      if (statusStage && response.status === 409) {
        const pollError = reason ?? summary.split('/')[0];
        if (pollError === 'invalid_async_job_id') throw new DropboxError(409, pollError, statusStage);
        if (pollError === 'internal_error') {
          const action =
            statusStage === 'dropbox.move-batch'
              ? 'check-move'
              : statusStage === 'dropbox.folders-batch'
                ? 'check-folders'
                : undefined;
          throw new BatchStatusUnconfirmed(
            {code: failureCodes.changed, stage: statusStage, status: 409, action},
            'Dropbox kunne ikke bekrefte statusen for batchen.',
          );
        }
      }
      if (path.startsWith('sharing/') && (reason === 'missing_scope' || /^missing_scope(?:\/|$)/.test(summary))) {
        const current = credentials();
        if (current?.scopes)
          localStorage.setItem(
            authKey,
            JSON.stringify({...current, scopes: current.scopes.filter(scope => !sharingScopes.includes(scope))}),
          );
        throw new SyncFailure(
          {code: failureCodes.permission, stage: 'dropbox.sharing-scope', status: response.status},
          'Dropbox mangler tillatelse til delingslenker. Velg Kopier delingslenke igjen for å gi tilgang.',
        );
      }
      throw new DropboxError(response.status, summary);
    }
    return json(response);
  }
  const missing = (error: unknown) =>
    error instanceof DropboxError && error.status === 409 && /^path\/not_found/.test(error.summary);
  async function metadata(path: string) {
    try {
      return await rpc('files/get_metadata', {path});
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }
  async function namespaceCheck(route: string, id: string, kind: 'delete' | 'folders', attempt = 0) {
    try {
      return namespaceReply(await rpc(route, {async_job_id: id}, attempt), kind);
    } catch (error) {
      if (error instanceof DropboxError && error.status === 409 && /^invalid_async_job_id(?:\/|$)/.test(error.summary))
        return {jobExpired: true} as const;
      throw error;
    }
  }
  async function sharedLink(folder: {id: string; path: string}, verifyTarget?: () => Promise<void>) {
    const samePath = (a: string, b: string) => a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();
    const policyError = () =>
      new SyncFailure(
        {code: failureCodes.permission, stage: 'dropbox.sharing-policy'},
        'Dropbox-kontoen tillater ikke en leselenke til sangbokens delingsmappe.',
      );
    function viewerUrl(link: unknown): string | null | undefined {
      const id = field(link, 'id'),
        lower = field(link, 'path_lower'),
        expires = field(link, 'expires'),
        href = field(link, 'url');
      if (tag(link) !== 'folder' || (id && id !== folder.id)) return;
      if (typeof lower === 'string' && !samePath(lower, folder.path)) {
        if (id === folder.id)
          throw new SyncFailure(
            {code: failureCodes.changed, stage: 'dropbox.sharing-target'},
            'Sangbokens delingsmappe har flyttet seg. Kontroller sangboken og prøv igjen.',
          );
        return;
      }
      if (!id && typeof lower !== 'string') return;
      const permissions = field(link, 'link_permissions');
      const audience =
        field(permissions, 'effective_audience', '.tag') ?? field(permissions, 'resolved_visibility', '.tag');
      const access = field(permissions, 'link_access_level', '.tag');
      // The documented legacy folder-link response uses resolved_visibility in place
      // of effective_audience. Its public folder links grant read access.
      const legacyViewer =
        field(permissions, 'effective_audience') == null &&
        field(permissions, 'link_access_level') == null &&
        field(permissions, 'resolved_visibility', '.tag') === 'public';
      if (
        oneOf(audience, [
          'team',
          'team_only',
          'public_logged_in_only',
          'no_one',
          'password',
          'team_and_password',
          'members',
          'shared_folder_only',
        ]) ||
        field(permissions, 'require_password') === true ||
        access === 'editor'
      )
        return null;
      if (
        audience !== 'public' ||
        (access !== 'viewer' && !legacyViewer) ||
        (expires && !(Date.parse(String(expires)) > Date.now())) ||
        typeof href !== 'string'
      )
        return;
      try {
        const url = new URL(href);
        if (
          url.protocol === 'https:' &&
          ['www.dropbox.com', 'dropbox.com'].includes(url.hostname) &&
          !url.username &&
          !url.password
        )
          return href;
      } catch {
        /* An invalid URL cannot be copied as a Dropbox link. */
      }
    }
    async function lookup() {
      let args: {path: string; direct_only: true} | {cursor: string} = {path: folder.id, direct_only: true};
      const cursors = new Set<string>();
      for (;;) {
        const page = await rpc('sharing/list_shared_links', args),
          links = list(field(page, 'links')),
          more = field(page, 'has_more'),
          cursor = text(field(page, 'cursor'));
        if (!links || typeof more !== 'boolean') break;
        const url = links.map(viewerUrl).find(candidate => typeof candidate === 'string');
        if (url || !more) return url;
        if (!cursor || cursors.has(cursor)) break;
        cursors.add(cursor);
        args = {cursor};
      }
      throw new SyncFailure(
        {code: failureCodes.response, stage: 'dropbox.sharing'},
        'Kunne ikke lese hele delingsoversikten fra Dropbox.',
      );
    }
    const existing = await lookup();
    if (existing) return existing;
    try {
      const metadata = await rpc(
        'sharing/create_shared_link_with_settings',
        {path: folder.id, settings: {audience: {'.tag': 'public'}, access: {'.tag': 'viewer'}}},
        0,
        {},
        {beforeSend: verifyTarget},
      );
      const url = viewerUrl(metadata);
      if (url === null) throw policyError();
      if (url) return url;
    } catch (error) {
      if (
        error instanceof DropboxError &&
        error.status === 409 &&
        /^shared_link_already_exists(?:\/|$)/.test(error.summary)
      ) {
        const url = await lookup();
        if (url) return url;
      } else if (
        error instanceof DropboxError &&
        (error.status === 403 ||
          (error.status === 409 && /^(access_denied|settings_error|email_not_verified)(?:\/|$)/.test(error.summary)))
      )
        throw policyError();
      else throw error;
    }
    throw new SyncFailure(
      {code: failureCodes.response, stage: 'dropbox.sharing-verification'},
      'Kunne ikke bekrefte lesetilgang til sangbokens delingsmappe.',
    );
  }
  /**
   * #101 F05: reads a shared folder through its link. Every folder below it is listed, because
   * Dropbox cannot list a shared link recursively, so a link above one of the user's own
   * songbook folders is recognized by folder ID.
   */
  async function testSharedFolder(url: string, ownFolders: ReadonlySet<string>): Promise<ImportTest> {
    const linkFailure = (error: unknown): ImportTest | undefined => {
      if (!(error instanceof DropboxError) || error.status !== 409) return;
      return /^shared_link_not_found(?:\/|$)/.test(error.summary) ? 'not-found' : 'not-shared';
    };
    try {
      const link = await rpc('sharing/get_shared_link_metadata', {url});
      const permissions = field(link, 'link_permissions'),
        audience =
          field(permissions, 'effective_audience', '.tag') ?? field(permissions, 'resolved_visibility', '.tag'),
        expires = field(link, 'expires');
      if (tag(link) !== 'folder') return 'not-shared';
      if (expires && !(Date.parse(String(expires)) > Date.now())) return 'not-found';
      if (
        field(permissions, 'require_password') === true ||
        field(permissions, 'allow_download') === false ||
        oneOf(audience, ['password', 'team_and_password', 'team', 'team_only', 'no_one', 'members'])
      )
        return 'not-shared';
      // The app folder app can look up a folder ID only inside its own folder, so a found
      // ID is the user's own app data. Dropbox reports a path for every own link, also
      // outside the app folder, so the path alone does not decide it.
      const root = field(link, 'id');
      const inAppFolder = async (id: string) => {
        try {
          return Boolean(await metadata(id));
        } catch (error) {
          // Any lookup refusal for the ID means it is outside what the app can see.
          if (error instanceof DropboxError && error.status === 409) return false;
          throw error;
        }
      };
      if (typeof root === 'string' && (ownFolders.has(root) || (await inAppFolder(root)))) return 'own-songbook';
      const pending = [''];
      for (let folder = pending.shift(); folder !== undefined; folder = pending.shift()) {
        const found: string[] = [];
        try {
          let page = await rpc('files/list_folder', {path: folder, shared_link: {url}});
          for (;;) {
            for (const entry of list(field(page, 'entries')) ?? []) {
              if (tag(entry) !== 'folder') continue;
              const id = field(entry, 'id'),
                name = text(field(entry, 'name'));
              if (typeof id === 'string' && ownFolders.has(id)) return 'own-songbook';
              if (name) found.push(`${folder}/${name}`);
            }
            const cursor = text(field(page, 'cursor'));
            if (field(page, 'has_more') !== true || !cursor) break;
            page = await rpc('files/list_folder/continue', {cursor});
          }
        } catch (error) {
          // A subfolder that cannot be listed, for example one removed meanwhile, is skipped.
          // A refusal for the link itself still answers the test.
          if (folder && error instanceof DropboxError && error.status === 409) continue;
          throw error;
        }
        pending.push(...found);
      }
      return 'ok';
    } catch (error) {
      return linkFailure(error) ?? 'unavailable';
    }
  }
  /** Downloads one file through a content route; null when Dropbox reports the path missing. */
  async function download(route: string, arg: unknown, context: ApiContext) {
    await beforeRequest();
    const accessToken = await access();
    await beforeRequest();
    const response = await send(
      route,
      {
        method: 'POST',
        headers: {Authorization: `Bearer ${accessToken}`, 'Dropbox-API-Arg': apiArg(arg)},
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      },
      undefined,
      context,
    );
    await beforeRequest();
    if (!response.ok) {
      const value: unknown = await response.json().catch(() => ({}));
      const error = new DropboxError(response.status, errorSummary(value) ?? 'download');
      if (missing(error)) return null;
      throw error;
    }
    let meta: unknown;
    try {
      meta = JSON.parse(response.headers.get('Dropbox-API-Result') ?? 'null');
    } catch (cause) {
      throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.download'}, 'Ugyldig metadataheader.', cause);
    }
    const reported = field(meta, 'size');
    if (typeof reported === 'number' && reported > maxFileBytes) {
      await response.body?.cancel();
      throw new SkippedFile();
    }
    const reader = response.body?.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader)
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxFileBytes) {
            await reader.cancel();
            throw new SkippedFile();
          }
          chunks.push(chunk.value);
        }
    } catch (cause) {
      if (cause instanceof SkippedFile) throw cause;
      throw new SyncFailure(
        {code: failureCodes.network, stage: 'dropbox.download', status: response.status},
        'Dropbox-nedlastingen ble avbrutt.',
        cause,
      );
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {meta, text: new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes)};
  }
  async function writeFile(path: string, text: string, rev: string | null, releaseFence = false) {
    checkSize(textBytes(text));
    await beforeRequest();
    const accessToken = await access(undefined, releaseFence);
    await beforeRequest();
    const args = {
      path,
      mode: rev ? {'.tag': 'update', update: rev} : {'.tag': 'add'},
      autorename: false,
      strict_conflict: true,
      mute: true,
    };
    const response = await send(
      'files/upload',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': apiArg(args),
        },
        body: new TextEncoder().encode(text),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      },
      undefined,
      {resource: resource(path)},
      {releaseFence, finishMove: path === libraryPath},
    );
    await beforeRequest();
    if (!response.ok) {
      const value: unknown = await response.json().catch(() => ({}));
      throw new DropboxError(response.status, errorSummary(value) ?? 'upload');
    }
    return fileValue(await json(response, 'dropbox.upload'), text, path);
  }
  const files: RemoteFiles = {
    async withMoveReceipt(work) {
      finishingMove++;
      try {
        return await work();
      } finally {
        finishingMove--;
      }
    },
    async metadata(path) {
      const value = await metadata(path);
      if (!value) return null;
      const actual = displayPath(value, path.startsWith('/') ? path : undefined),
        id = field(value, 'id'),
        kind = tag(value),
        rev = field(value, 'rev');
      if (
        typeof id !== 'string' ||
        !id ||
        typeof actual !== 'string' ||
        !actual ||
        (kind !== 'file' && kind !== 'folder') ||
        (kind === 'file' && (typeof rev !== 'string' || !rev))
      )
        throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.file-metadata'}, 'Ugyldig metadata.');
      return {id, path: actual, folder: kind === 'folder', ...(typeof rev === 'string' && rev ? {rev} : {})};
    },
    async deleteBatch(entries, attempt = 0, options) {
      if (
        !entries.length ||
        entries.length > 1000 ||
        entries.some(entry => (entry.folder && entry.rev) || (!entry.folder && !entry.rev))
      )
        throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.delete-batch'}, 'Ugyldig sletteplan.');
      const result = namespaceReply(
        await rpc(
          'files/delete_batch',
          {entries: entries.map(entry => ({path: entry.path, ...(entry.rev ? {parent_rev: entry.rev} : {})}))},
          attempt,
          {
            resource:
              new Set(entries.map(entry => entry.category)).size === 1
                ? entries[0].category === 'folder' || entries[0].category === 'import'
                  ? 'folder'
                  : entries[0].category
                : 'mixed',
          },
          {namespacePlanAttempt: options?.revalidateAfterWait ? attempt : undefined},
        ),
        'delete',
      );
      if ('entries' in result && result.entries.length !== entries.length)
        throw new SyncFailure(
          {code: failureCodes.response, stage: 'dropbox.delete-batch'},
          'Ufullstendig slettekvittering.',
        );
      return result;
    },
    checkDeleteBatch: (id, attempt) => namespaceCheck('files/delete_batch/check', id, 'delete', attempt),
    async createFoldersBatch(entries, attempt = 0, options) {
      if (!entries.length || entries.length > 10000)
        throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.folders-batch'}, 'Ugyldig mappeplan.');
      const result = namespaceReply(
        await rpc(
          'files/create_folder_batch',
          {paths: entries.map(entry => entry.path), autorename: false, force_async: false},
          attempt,
          {resource: 'folder'},
          {namespacePlanAttempt: options?.revalidateAfterWait ? attempt : undefined},
        ),
        'folders',
      );
      if ('entries' in result && result.entries.length !== entries.length)
        throw new SyncFailure(
          {code: failureCodes.response, stage: 'dropbox.folders-batch'},
          'Ufullstendig mappekvittering.',
        );
      return result;
    },
    checkCreateFoldersBatch: (id, attempt) => namespaceCheck('files/create_folder_batch/check', id, 'folders', attempt),
    async moveBatch(entries, retryAttempt = 0, options) {
      if (!entries.length || entries.length > 1000)
        throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.move-batch'}, 'Ugyldig flyttegruppe.');
      const result = moveReply(
        await rpc(
          'files/move_batch_v2',
          {
            entries: entries.map(entry => ({from_path: entry.from, to_path: entry.toReference ?? entry.to})),
            autorename: false,
            allow_ownership_transfer: false,
          },
          retryAttempt,
          {},
          {namespacePlanAttempt: options?.revalidateAfterWait ? retryAttempt : undefined},
        ),
        true,
      );
      if ('entries' in result && result.entries.length !== entries.length)
        throw new SyncFailure(
          {code: failureCodes.response, stage: 'dropbox.move-batch'},
          'Ufullstendig flytterespons.',
        );
      return result;
    },
    async checkMoveBatch(id, retryAttempt = 0) {
      try {
        return moveReply(await rpc('files/move_batch/check_v2', {async_job_id: id}, retryAttempt), false);
      } catch (error) {
        if (
          error instanceof DropboxError &&
          error.status === 409 &&
          /^invalid_async_job_id(?:\/|$)/.test(error.summary)
        )
          return {jobExpired: true};
        throw error;
      }
    },
    async changes(cursor) {
      let reset = !cursor,
        page: unknown;
      try {
        page = await rpc(
          cursor ? 'files/list_folder/continue' : 'files/list_folder',
          cursor ? {cursor} : {path: '', recursive: true, include_deleted: true},
        );
      } catch (error) {
        if (
          !cursor ||
          !(error instanceof DropboxError) ||
          error.status !== 409 ||
          !/^reset(?:\/|$)/.test(error.summary)
        )
          throw error;
        reset = true;
        page = await rpc('files/list_folder', {path: '', recursive: true, include_deleted: true});
      }
      const entries: RemoteEntry[] = [];
      for (;;) {
        const listed = list(field(page, 'entries')),
          more = field(page, 'has_more'),
          next = field(page, 'cursor');
        if (!listed || typeof more !== 'boolean' || typeof next !== 'string' || !next)
          throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.list'}, 'Ugyldig endringsoversikt.');
        for (const entry of listed) entries.push(changeEntry(entry));
        if (!more) return {entries, cursor: next, reset};
        page = await rpc('files/list_folder/continue', {cursor: next});
      }
    },
    async read(path, knownPath) {
      // A read by file ID is classified by the path it is known by.
      const result = await download('files/download', {path}, {resource: resource(knownPath ?? path)});
      if (!result) return null;
      return fileValue(result.meta, result.text, knownPath ?? path);
    },
    async listShared(url, path, cursor) {
      const resetCursor = (error: unknown) =>
        error instanceof DropboxError && error.status === 409 && /^reset(?:\/|$)/.test(error.summary);
      let reset = !cursor,
        page: unknown;
      try {
        page = cursor
          ? await rpc('files/list_folder/continue', {cursor})
          : await rpc('files/list_folder', {path, shared_link: {url}});
      } catch (error) {
        if (!cursor || !resetCursor(error)) throw error;
        reset = true;
        page = await rpc('files/list_folder', {path, shared_link: {url}});
      }
      const entries: SharedEntry[] = [];
      for (;;) {
        const listed = list(field(page, 'entries')),
          more = field(page, 'has_more'),
          next = text(field(page, 'cursor'));
        if (!listed || typeof more !== 'boolean' || !next)
          throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.shared-list'}, 'Ugyldig mappeoversikt.');
        for (const entry of listed) {
          const kind = tag(entry),
            name = text(field(entry, 'name')),
            id = text(field(entry, 'id'));
          if (!name || name.includes('/')) continue;
          if (kind === 'deleted') entries.push({kind, name});
          else if (kind === 'folder' && id) entries.push({kind, id, name});
          else if (kind === 'file' && id) {
            const hash = text(field(entry, 'content_hash')),
              size = field(entry, 'size');
            if (hash && typeof size === 'number') entries.push({kind, id, name, hash, size});
          }
        }
        if (!more) return {entries, cursor: next, reset};
        page = await rpc('files/list_folder/continue', {cursor: next});
      }
    },
    async readShared(url, path) {
      const result = await download('sharing/get_shared_link_file', {url, path}, {resource: 'content'});
      if (!result) throw new DropboxError(409, 'shared_link_not_found');
      return result.text;
    },
    write: writeFile,
    releaseMutation: (text, rev) => writeFile(mutationPath, text, rev, true),
    async beginUpload(text) {
      checkSize(textBytes(text));
      await beforeRequest();
      const accessToken = await access();
      await beforeRequest();
      const response = await send('files/upload_session/start', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': apiArg({close: true}),
        },
        body: new TextEncoder().encode(text),
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      await beforeRequest();
      if (!response.ok) {
        throw new DropboxError(response.status, 'session', 'dropbox.upload');
      }
      const id = field(await json(response, 'dropbox.upload'), 'session_id');
      if (typeof id !== 'string' || !id)
        throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.upload'}, 'Ugyldig opplastingsøkt.');
      return {id, created: Date.now()};
    },
    async beginUploadBatch(texts) {
      const stage = 'dropbox.upload';
      if (texts.length < 2 || texts.length > 500)
        throw new SyncFailure({code: failureCodes.response, stage}, 'Ugyldig gruppe opplastingsøkter.');
      const encoder = new TextEncoder();
      const contents = texts.map(text => {
        const bytes = encoder.encode(text);
        checkSize(bytes.length);
        return bytes;
      });
      const byteLength = contents.reduce((total, bytes) => total + bytes.length, 0);
      if (byteLength > maxBatchAppendBytes)
        throw new SyncFailure({code: failureCodes.response, stage}, 'Opplastingsgruppen overskrider Dropbox-grensen.');
      const started = await rpc('files/upload_session/start_batch', {num_sessions: contents.length});
      const ids = list(field(started, 'session_ids'));
      if (
        !ids ||
        ids.length !== contents.length ||
        !ids.every((id): id is string => typeof id === 'string' && Boolean(id)) ||
        new Set(ids).size !== ids.length
      ) {
        throw new SyncFailure({code: failureCodes.response, stage}, 'Ugyldig svar for opplastingsøktene.');
      }
      const created = Date.now(),
        body = new Uint8Array(byteLength);
      let position = 0;
      const entries = contents.map((bytes, index) => {
        body.set(bytes, position);
        position += bytes.length;
        return {cursor: {session_id: ids[index], offset: 0}, length: bytes.length, close: true};
      });
      await beforeRequest();
      const accessToken = await access();
      await beforeRequest();
      const response = await send(
        'files/upload_session/append_batch',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/octet-stream',
            'Dropbox-API-Arg': apiArg({entries}),
          },
          body,
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        },
        undefined,
        {batchSize: entries.length},
      );
      await beforeRequest();
      if (!response.ok) {
        throw new DropboxError(response.status, 'append-batch', stage);
      }
      const appended = list(field(await json(response, stage), 'entries'));
      if (!appended || appended.length !== ids.length)
        throw new SyncFailure({code: failureCodes.response, stage}, 'Ufullstendig svar for opplastingsgruppen.');
      return appended.map((entry, i) => {
        if (tag(entry) === 'success') return {session: {id: ids[i], created}};
        if (tag(entry) === 'failure' && tag(entry, 'failure') !== undefined)
          return {failure: {code: failureCodes.request, stage, status: 200}};
        throw new SyncFailure({code: failureCodes.response, stage}, 'Ugyldig svaroppføring for opplastingsgruppen.');
      });
    },
    async commitBatch(jobs) {
      if (!jobs.length || jobs.length > 1000 || jobs.some(job => !job.session))
        throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.batch'}, 'Ugyldig opplastingsgruppe.');
      for (const job of jobs) checkSize(textBytes(job.text));
      await beforeRequest();
      const accessToken = await access();
      await beforeRequest();
      let pending = jobs.map((_, i) => i);
      const results: UploadResult[] = new Array(jobs.length);
      const response = await send(
        'files/upload_session/finish_batch_v2',
        () => ({
          method: 'POST',
          headers: {Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json'},
          body: JSON.stringify({
            entries: pending.map(i => {
              const job = jobs[i];
              return {
                cursor: {session_id: job.session!.id, offset: textBytes(job.text)},
                commit: {
                  path: job.path,
                  mode: job.rev ? {'.tag': 'update', update: job.rev} : {'.tag': 'add'},
                  autorename: false,
                  strict_conflict: true,
                  mute: true,
                },
              };
            }),
          }),
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        }),
        async reply => {
          if (!reply.ok) return reply;
          const finished = list(field(await json(reply, 'dropbox.batch'), 'entries'));
          if (!finished || finished.length !== pending.length)
            throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.batch'}, 'Ufullstendig batchrespons.');
          const throttled: number[] = [];
          for (let n = 0; n < pending.length; n++) {
            const i = pending[n],
              entry = finished[n],
              job = jobs[i],
              kind = tag(entry, 'failure');
            if (tag(entry) === 'success') results[i] = {value: fileValue(entry, job.text, job.path)};
            else if (tag(entry) === 'failure' && kind !== undefined) {
              if (
                kind === 'too_many_write_operations' ||
                (kind === 'path' && tag(entry, 'failure', 'path') === 'too_many_write_operations')
              ) {
                throttled.push(i);
                continue;
              }
              const resetSession =
                kind === 'lookup_failed' && oneOf(tag(entry, 'failure', 'lookup_failed'), ['not_found', 'closed']);
              const conflict = kind === 'path' && tag(entry, 'failure', 'path') === 'conflict';
              results[i] = {
                failure: {
                  code: conflict ? failureCodes.changed : failureCodes.request,
                  stage: 'dropbox.batch',
                  status: 200,
                },
                ...(resetSession ? {resetSession: true} : {}),
              };
            } else
              throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.batch'}, 'Ugyldig batchoppføring.');
          }
          pending = throttled;
          // Per-entry lock contention uses the same bounded shared backpressure as HTTP 429.
          if (pending.length) {
            const limited = new Response(
              JSON.stringify({error: {reason: {'.tag': 'too_many_write_operations'}, retry_after: 0}}),
              {status: 429, headers: {'Retry-After': '0', 'Content-Type': 'application/json'}},
            );
            Object.defineProperty(limited, 'entryLimit', {value: true});
            return limited;
          }
          return new Response(JSON.stringify({entries: results}), {headers: {'Content-Type': 'application/json'}});
        },
      );
      await beforeRequest();
      if (!response.ok) {
        throw new DropboxError(response.status, 'batch', 'dropbox.batch');
      }
      // A successful reply is the one the transform above built from these results.
      return results;
    },
    async folder(path, expectedId, knownMissing) {
      const samePath = (a: string) => a.normalize('NFC').toLowerCase() === path.normalize('NFC').toLowerCase();
      const found = knownMissing && !expectedId ? null : await metadata(expectedId ?? path);
      let current = found
        ? {kind: field(found, '.tag'), id: field(found, 'id'), path: displayPath(found, expectedId ? undefined : path)}
        : null;
      if (expectedId && !current)
        throw new SyncFailure(
          {code: failureCodes.missingFolder, stage: 'dropbox.ensure-folder'},
          'Kjent sangbokmappe mangler.',
        );
      if (expectedId && current?.kind === 'folder' && typeof current.path === 'string' && !samePath(current.path))
        throw new DeferredSync('remote', 'Dropbox har endringer som venter på manuell synk.');
      if (!current) {
        try {
          // CreateFolderResult.metadata is FolderMetadata, not the tagged Metadata union.
          // Unlike get_metadata, the successful create response normally has no .tag.
          const created = field(await rpc('files/create_folder_v2', {path, autorename: false}), 'metadata'),
            kind = field(created, '.tag'),
            id = field(created, 'id'),
            actual = field(created, 'path_display') ?? path;
          if (
            !created ||
            (kind && kind !== 'folder') ||
            typeof id !== 'string' ||
            !id ||
            typeof actual !== 'string' ||
            !samePath(actual)
          )
            throw new SyncFailure(
              {code: failureCodes.folderResponse, stage: 'dropbox.create-folder'},
              'Dropbox returnerte ugyldig bekreftelse på mappeopprettelse.',
            );
          return {id, path: actual};
        } catch (error) {
          if (!(error instanceof DropboxError && error.status === 409 && /^path\/conflict\//.test(error.summary)))
            throw error;
          const existing = await metadata(path);
          if (!existing) throw error;
          current = {kind: field(existing, '.tag'), id: field(existing, 'id'), path: field(existing, 'path_display')};
        }
      }
      if (current.kind !== 'folder')
        throw new SyncFailure(
          {code: failureCodes.folderOccupied, stage: 'dropbox.ensure-folder', action: 'folder-layout'},
          'Dropbox-stien er opptatt av en fil.',
        );
      if (typeof current.id !== 'string' || !current.id || typeof current.path !== 'string')
        throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.ensure-folder'}, 'Ugyldig mappemetadata.');
      return {id: current.id, path: current.path};
    },
    async locateFolder(id) {
      const value = await metadata(id);
      if (!value) return null;
      const actualId = field(value, 'id'),
        actual = displayPath(value, id.startsWith('/') ? id : undefined);
      if (tag(value) !== 'folder' || typeof actualId !== 'string' || typeof actual !== 'string')
        throw new SyncFailure(
          {code: failureCodes.response, stage: 'dropbox.locate-folder'},
          'Ugyldig kjent mappemetadata.',
        );
      return {id: actualId, path: actual};
    },
    async move(from, to, known) {
      const current = known ? {id: known.id, path_display: known.path} : await metadata(from);
      if (!current)
        throw new SyncFailure(
          {code: failureCodes.missingFile, stage: 'dropbox.move'},
          'Oppføringen som skal flyttes mangler.',
        );
      if (displayPath(current, from.startsWith('/') ? from : undefined) === to) {
        const id = field(current, 'id');
        if (typeof id !== 'string')
          throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.move'}, 'Ugyldig metadata.');
        return {id, path: to};
      }
      const moved = field(await rpc('files/move_v2', {from_path: from, to_path: to, autorename: false}), 'metadata'),
        id = field(moved, 'id'),
        actual = field(moved, 'path_display');
      if (typeof id !== 'string' || (actual != null && typeof actual !== 'string'))
        throw new SyncFailure({code: failureCodes.response, stage: 'dropbox.move'}, 'Ugyldig flytterespons.');
      return {id, path: typeof actual === 'string' ? actual : to};
    },
    async list(path) {
      const entries: {id: string; path: string; folder: boolean}[] = [];
      const invalid = () =>
        new SyncFailure({code: failureCodes.response, stage: 'dropbox.list'}, 'Ugyldig mappelisting.');
      let page = await rpc('files/list_folder', {path, recursive: false, include_deleted: false});
      for (;;) {
        const listed = list(field(page, 'entries')),
          more = field(page, 'has_more'),
          cursor = field(page, 'cursor');
        if (!listed || typeof more !== 'boolean' || (more && typeof cursor !== 'string')) throw invalid();
        for (const entry of listed) {
          const id = field(entry, 'id'),
            actual = field(entry, 'path_display');
          if (typeof id !== 'string' || typeof actual !== 'string') throw invalid();
          entries.push({id, path: actual, folder: tag(entry) === 'folder'});
        }
        if (!more) return entries;
        page = await rpc('files/list_folder/continue', {cursor});
      }
    },
    async removeEmpty(path) {
      if (!(await metadata(path))) return true;
      if ((await files.list(path)).length) return false;
      // Product-approved limitation: Dropbox has no atomic empty-only folder delete.
      await rpc('files/delete_v2', {path});
      return true;
    },
    async deleteFile(path, rev) {
      try {
        await rpc('files/delete_v2', {path, parent_rev: rev});
      } catch (error) {
        if (
          !missing(error) &&
          !(error instanceof DropboxError && error.status === 409 && /^path_lookup\/not_found/.test(error.summary))
        )
          throw error;
      }
    },
  };
  async function disconnect() {
    invalidated++;
    rate.cancel();
    const value = credentials();
    localStorage.removeItem(authKey);
    sessionStorage.removeItem(pendingKey);
    if (!value) return true;
    const init = {method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'} as const;
    const revoke = (accessToken: string) =>
      send('auth/token/revoke', {...init, headers: {Authorization: `Bearer ${accessToken}`}});
    // Revoking an access token also disables its refresh token. Dropbox rejects
    // an expired access token, so renew it first with the saved refresh token.
    async function renewed() {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: value!.refreshToken,
        client_id: config.key,
      });
      const response = await send('oauth2/token', {...init, body}, undefined, {}, {immediate: true});
      return response.ok ? tokenReply(await json(response, 'dropbox.token')).accessToken : null;
    }
    let response = value.accessToken && value.expires > Date.now() + 60000 ? await revoke(value.accessToken) : null;
    if (!response || response.status === 401) {
      const accessToken = await renewed();
      if (!accessToken) return false;
      response = await revoke(accessToken);
    }
    return response.ok;
  }
  return {
    account,
    connect,
    callback,
    disconnect,
    files,
    sharedLink,
    testSharedFolder,
    sharingAllowed,
    beginRun: rate.begin,
    cancelPending: rate.cancel,
  };
}
