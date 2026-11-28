/** HTTP-level Dropbox simulator; app builds contain no test hooks or credentials. */
export async function dropboxMock(context, {connected = true, pageSize = 2000, backend, sharing = false} = {}) {
  let sequence = 0;
  const entries = backend?.entries ?? new Map(),
    history = backend?.history ?? new Map(),
    sessions = backend?.sessions ?? new Map(),
    moveJobs = backend?.moveJobs ?? new Map(),
    calls = [];
  let fault = null,
    hold = null,
    lostBatch = false,
    batchFailure = null,
    lostMove = false,
    nextAsyncMove = null,
    moveFailure = null;
  let latency = 0,
    active = 0,
    maximum = 0,
    namespaceAsync = null,
    lostDelete = false,
    lostFolders = false;
  const namespaceJobs = backend?.namespaceJobs ?? new Map();
  let limitWrites = false,
    activeWrites = 0,
    rateCount = 0;
  const links = new Map();
  // Shared links owned by another account: url -> {meta, folders: {path: entries}} or {error}.
  const foreign = new Map();
  const mutating = endpoint =>
    [
      '/upload',
      '/upload_session/finish_batch_v2',
      '/create_folder_v2',
      '/create_folder_batch',
      '/move_v2',
      '/move_batch_v2',
      '/delete_v2',
      '/delete_batch',
    ].some(value => endpoint.endsWith(value));
  const rateResponse = async (route, seconds = 0, reason = 'too_many_write_operations') => {
    rateCount++;
    return route.fulfill({
      status: 429,
      headers: {'Retry-After': String(seconds)},
      json: {error_summary: reason + '/', error: {reason: {'.tag': reason}, retry_after: seconds}},
    });
  };
  const key = path => path.toLowerCase();
  const reference = path => {
    if (!path.startsWith('id:') || !path.includes('/')) return path;
    const slash = path.indexOf('/'),
      parent = [...entries.values()].find(e => e.id === path.slice(0, slash));
    return parent ? parent.path_display + path.slice(slash) : path;
  };
  const find = path =>
    path.startsWith('id:') && !path.includes('/')
      ? [...entries.values()].find(e => e.id === path)
      : path.startsWith('rev:')
        ? history.get(path.slice(4))
        : entries.get(key(reference(path)));
  function put(path, text, folder = false) {
    if (backend) return backend.put(path, text, folder);
    const old = find(path),
      value = {
        '.tag': folder ? 'folder' : 'file',
        id: old?.id ?? `id:${++sequence}`,
        path_display: path,
        path_lower: key(path),
        rev: String(++sequence),
        text,
        ...(!folder ? {size: Buffer.byteLength(text)} : {}),
      };
    entries.set(key(path), value);
    history.set(value.rev, {...value});
    return value;
  }
  const metadata = value => {
    const copy = {...value};
    delete copy.text;
    return copy;
  };
  const relocation = (from, to) => {
    to = reference(to);
    const value = find(from),
      failure = error => ({'.tag': 'failure', failure: {'.tag': 'relocation_error', relocation_error: error}});
    if (moveFailure?.source === from) {
      if (--moveFailure.remaining <= 0) moveFailure = null;
      return failure({'.tag': 'from_write', from_write: {'.tag': 'too_many_write_operations'}});
    }
    if (!value) return failure({'.tag': 'from_lookup', from_lookup: {'.tag': 'not_found'}});
    if (to.startsWith('id:')) return failure({'.tag': 'to', to: {'.tag': 'not_found'}});
    if (find(to)) return failure({'.tag': 'to', to: {'.tag': 'conflict', conflict: {'.tag': 'file'}}});
    const prefix = value.path_display;
    for (const [name, item] of [...entries])
      if (item.path_display === prefix || (value['.tag'] === 'folder' && item.path_display.startsWith(prefix + '/'))) {
        entries.delete(name);
        item.path_display = to + item.path_display.slice(prefix.length);
        item.path_lower = key(item.path_display);
        entries.set(item.path_lower, item);
      }
    return {'.tag': 'success', success: metadata(value)};
  };
  const moveResult = job =>
    job.result ??
    (job.result = {'.tag': 'complete', entries: job.entries.map(entry => relocation(entry.from_path, entry.to_path))});
  function createFolder(path) {
    if (find(path))
      return {
        '.tag': 'failure',
        failure: {'.tag': 'path', path: {'.tag': 'conflict', conflict: {'.tag': find(path)['.tag']}}},
      };
    const parents = path.split('/').slice(1, -1);
    let parent = '';
    for (const name of parents) {
      parent += '/' + name;
      if (!find(parent)) put(parent, '', true);
    }
    const value = metadata(put(path, '', true));
    delete value['.tag'];
    return {'.tag': 'success', metadata: value};
  }
  function deleteEntry(entry) {
    const value = find(entry.path);
    if (value && entry.parent_rev && entry.parent_rev !== value.rev)
      return {
        '.tag': 'failure',
        failure: {'.tag': 'path_write', path_write: {'.tag': 'conflict', conflict: {'.tag': 'file'}}},
      };
    if (!value) return {'.tag': 'failure', failure: {'.tag': 'path_lookup', path_lookup: {'.tag': 'not_found'}}};
    const meta = metadata(value),
      prefix = key(value.path_display);
    for (const [name] of [...entries]) if (name === prefix || name.startsWith(prefix + '/')) entries.delete(name);
    return {'.tag': 'success', metadata: meta};
  }
  const namespaceResult = job =>
    job.result ??
    (job.result = {
      '.tag': 'complete',
      entries: job.kind === 'delete' ? job.entries.map(deleteEntry) : job.entries.map(createFolder),
    });
  const cursors = backend?.cursors ?? new Map();
  const snapshot = args =>
    new Map(
      [...entries.values()]
        .filter(
          e =>
            e.path_lower.startsWith(key(args.path) + '/') &&
            (args.recursive || !e.path_display.slice(args.path.length + 1).includes('/')),
        )
        .map(e => [e.path_lower, metadata(e)]),
    );
  const listPage = (items, current, args) => {
    const cursor = 'cursor-' + crypto.randomUUID(),
      remaining = items.slice(pageSize);
    cursors.set(cursor, {snapshot: current, args, remaining});
    return {entries: items.slice(0, pageSize), has_more: remaining.length > 0, cursor};
  };
  if (connected)
    await context.addInitScript(sharing => {
      const name = 'hobos-songbook-test:dropbox-auth-v1';
      if (!sessionStorage.getItem('mock-seeded')) {
        localStorage.setItem(
          name,
          JSON.stringify({
            version: 1,
            accountId: 'dbid:fixture',
            name: 'Prøvebruker med et langt navn',
            email: 'bruker.med.langt.navn@eksempel.no',
            accessToken: 'fixture-access',
            refreshToken: 'fixture-refresh',
            expires: Date.now() + 3600000,
            ...(sharing ? {scopes: ['sharing.read', 'sharing.write']} : {}),
          }),
        );
        sessionStorage.setItem('mock-seeded', 'yes');
      }
    }, sharing);
  await context.route(/https:\/\/(api|content)\.dropboxapi\.com\//, async route => {
    const request = route.request(),
      url = new URL(request.url()),
      endpoint = url.pathname;
    const body = request.postData();
    const args = request.headers()['dropbox-api-arg']
      ? JSON.parse(request.headers()['dropbox-api-arg'])
      : request.headers()['content-type']?.includes('application/json')
        ? JSON.parse(body ?? 'null')
        : null;
    calls.push({endpoint, args});
    const writing = mutating(endpoint);
    active++;
    if (writing) activeWrites++;
    maximum = Math.max(maximum, active);
    try {
      if (limitWrites && writing && activeWrites > 1) return await rateResponse(route);
      if (latency) await new Promise(resolve => setTimeout(resolve, latency));
      if (hold && endpoint.endsWith(hold.endpoint) && (!hold.path || hold.path === args?.path)) {
        const waiting = hold;
        if (!waiting.all) hold = null;
        await waiting.resolve;
      }
      if (fault && endpoint.endsWith(fault.endpoint) && (!fault.path || fault.path === args?.path)) {
        if (fault.skip) fault.skip--;
        else {
          const current = fault,
            status = current.status;
          if (--current.remaining <= 0) fault = null;
          if (status === 0) return route.abort('failed');
          if (status === 429) return await rateResponse(route, current.retryAfter, current.reason);
          await route.fulfill({
            status,
            json: {
              error_summary:
                status === 409 ? 'path/conflict/file/' : status === 401 ? 'invalid_access_token/' : 'error/',
            },
          });
          return;
        }
      }
      const ok = async value => route.fulfill({status: 200, json: value}),
        missing = async () => route.fulfill({status: 409, json: {error_summary: 'path/not_found/'}});
      if (endpoint === '/oauth2/token')
        return ok({
          access_token: 'fixture-access',
          refresh_token: 'fixture-refresh',
          expires_in: 3600,
          account_id: 'dbid:fixture',
          scope: 'account_info.read files.metadata.read files.content.read files.content.write',
        });
      if (endpoint.endsWith('/get_current_account'))
        return ok({account_id: 'dbid:fixture', name: {display_name: 'Prøvebruker'}, email: 'bruker@eksempel.no'});
      if (endpoint.endsWith('/token/revoke')) return ok(null);
      if (endpoint.endsWith('/get_shared_link_metadata')) {
        const shared = foreign.get(args.url);
        if (!shared) return route.fulfill({status: 409, json: {error_summary: 'shared_link_not_found/'}});
        if (shared.error) return route.fulfill({status: 409, json: {error_summary: shared.error}});
        return ok(shared.meta);
      }
      if (endpoint.endsWith('/list_folder') && args?.shared_link) {
        const shared = foreign.get(args.shared_link.url);
        if (!shared?.meta) return route.fulfill({status: 409, json: {error_summary: 'shared_link_not_found/'}});
        return ok({entries: shared.folders?.[args.path] ?? [], has_more: false, cursor: 'shared-' + args.path});
      }
      if (endpoint.startsWith('/2/sharing/')) {
        const folder = find(args.path);
        if (!folder || folder['.tag'] !== 'folder') return missing();
        if (endpoint.endsWith('/list_shared_links')) {
          if (args.direct_only !== true) throw Error('Expected a direct sharing lookup');
          return ok({has_more: false, links: links.has(folder.id) ? [links.get(folder.id)] : []});
        }
        if (endpoint.endsWith('/create_shared_link_with_settings')) {
          if (args.settings?.access?.['.tag'] !== 'viewer' || args.settings?.audience?.['.tag'] !== 'public')
            throw Error('Expected a read-only public link');
          if (links.has(folder.id))
            return route.fulfill({status: 409, json: {error_summary: 'shared_link_already_exists/'}});
          const link = {
            '.tag': 'folder',
            id: folder.id,
            path_lower: folder.path_lower,
            url: `https://www.dropbox.com/scl/fo/${folder.id.slice(3)}/Shared?rlkey=fixture`,
            link_permissions: {effective_audience: {'.tag': 'public'}, link_access_level: {'.tag': 'viewer'}},
          };
          links.set(folder.id, link);
          return ok(link);
        }
      }
      if (endpoint.endsWith('/get_metadata')) {
        const value = find(args.path);
        return value ? ok(metadata(value)) : missing();
      }
      if (endpoint.endsWith('/create_folder_v2')) {
        if (find(args.path)) return route.fulfill({status: 409, json: {error_summary: 'path/conflict/folder/'}});
        const value = metadata(put(args.path, '', true));
        delete value['.tag'];
        return ok({metadata: value});
      }
      if (endpoint.endsWith('/create_folder_batch') || endpoint.endsWith('/delete_batch')) {
        const kind = endpoint.endsWith('/delete_batch') ? 'delete' : 'folders',
          items = kind === 'delete' ? args.entries : args.paths;
        if (!items?.length || (kind === 'folders' && args.autorename !== false)) throw Error('Invalid namespace batch');
        if (namespaceAsync?.kind === kind) {
          const options = namespaceAsync;
          namespaceAsync = null;
          const id = 'namespace-job-' + crypto.randomUUID();
          namespaceJobs.set(id, {kind, entries: structuredClone(items), checks: options.checks});
          if (options.loseLaunch) return route.abort('failed');
          return ok({'.tag': 'async_job_id', async_job_id: id});
        }
        const result = namespaceResult({kind, entries: items});
        if (kind === 'delete' && lostDelete) {
          lostDelete = false;
          return route.abort('failed');
        }
        if (kind === 'folders' && lostFolders) {
          lostFolders = false;
          return route.abort('failed');
        }
        return ok(result);
      }
      if (endpoint.endsWith('/delete_batch/check') || endpoint.endsWith('/create_folder_batch/check')) {
        const job = namespaceJobs.get(args.async_job_id);
        if (!job) return route.fulfill({status: 409, json: {error_summary: 'invalid_async_job_id/'}});
        if (job.checks-- > 0) return ok({'.tag': 'in_progress'});
        return ok(namespaceResult(job));
      }
      if (endpoint.endsWith('/list_folder')) {
        const current = snapshot(args);
        return ok(listPage([...current.values()], current, args));
      }
      if (endpoint.endsWith('/list_folder/continue')) {
        const prior = cursors.get(args.cursor);
        if (!prior) return route.fulfill({status: 409, json: {error_summary: 'reset/'}});
        if (prior.remaining.length) return ok(listPage(prior.remaining, prior.snapshot, prior.args));
        const current = snapshot(prior.args),
          items = [];
        for (const [path, e] of prior.snapshot)
          if (!current.has(path)) items.push({'.tag': 'deleted', path_display: e.path_display, path_lower: path});
        for (const [path, e] of current)
          if (JSON.stringify(prior.snapshot.get(path)) !== JSON.stringify(e)) items.push(e);
        return ok(listPage(items, current, prior.args));
      }
      if (endpoint.endsWith('/download')) {
        const value = find(args.path);
        if (!value) return missing();
        const meta = metadata(value);
        delete meta['.tag'];
        return route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          headers: {'Access-Control-Expose-Headers': 'Dropbox-API-Result', 'Dropbox-API-Result': JSON.stringify(meta)},
          body: Buffer.from(value.text),
        });
      }
      if (endpoint.endsWith('/upload')) {
        const old = find(args.path);
        if (args.mode['.tag'] === 'update' ? old?.rev !== args.mode.update : Boolean(old))
          return route.fulfill({status: 409, json: {error_summary: 'path/conflict/file/'}});
        const value = metadata(put(args.path, Buffer.from(request.postDataBuffer()).toString('utf8')));
        delete value['.tag'];
        return ok(value);
      }
      if (endpoint.endsWith('/upload_session/start')) {
        if (url.host !== 'content.dropboxapi.com') throw Error('Upload session has wrong host');
        if (args.close !== true) throw Error('Session must be closed');
        const id = 'session-' + crypto.randomUUID();
        sessions.set(id, Buffer.from(request.postDataBuffer()));
        return ok({session_id: id});
      }
      if (endpoint.endsWith('/upload_session/start_batch')) {
        if (
          url.host !== 'api.dropboxapi.com' ||
          !Number.isInteger(args.num_sessions) ||
          args.num_sessions < 1 ||
          args.num_sessions > 1000
        )
          throw Error('Invalid batch start');
        return ok({
          session_ids: Array.from({length: args.num_sessions}, () => {
            const id = 'session-' + crypto.randomUUID();
            sessions.set(id, null);
            return id;
          }),
        });
      }
      if (endpoint.endsWith('/upload_session/append_batch')) {
        const bytes = request.postDataBuffer() ?? Buffer.alloc(0);
        if (
          url.host !== 'content.dropboxapi.com' ||
          !args.entries.length ||
          args.entries.length > 500 ||
          bytes.length > 150 * 1024 * 1024 ||
          args.entries.reduce((sum, item) => sum + item.length, 0) !== bytes.length
        )
          throw Error('Invalid batch append');
        let offset = 0;
        const results = args.entries.map(({cursor, length, close}) => {
          if (cursor.offset !== 0 || close !== true || !Number.isInteger(length) || length < 0)
            throw Error('Expected complete upload sessions');
          const content = bytes.subarray(offset, offset + length);
          offset += length;
          if (!sessions.has(cursor.session_id)) return {'.tag': 'failure', failure: {'.tag': 'not_found'}};
          if (sessions.get(cursor.session_id) !== null) return {'.tag': 'failure', failure: {'.tag': 'closed'}};
          sessions.set(cursor.session_id, content);
          return {'.tag': 'success'};
        });
        return ok({entries: results});
      }
      if (endpoint.endsWith('/upload_session/finish_batch_v2')) {
        if (url.host !== 'api.dropboxapi.com' || !args.entries.length || args.entries.length > 1000)
          throw Error('Invalid batch request');
        const results = args.entries.map(({cursor, commit}) => {
          if (commit.autorename !== false || commit.strict_conflict !== true)
            throw Error('Batch must preserve revision guards');
          if (batchFailure && commit.path === batchFailure.path) {
            const failure = {
              '.tag': 'failure',
              failure:
                batchFailure.tag === 'path/too_many_write_operations'
                  ? {'.tag': 'path', path: {'.tag': 'too_many_write_operations'}}
                  : {'.tag': batchFailure.tag},
            };
            if (--batchFailure.remaining <= 0) batchFailure = null;
            return failure;
          }
          const bytes = sessions.get(cursor.session_id);
          if (!bytes)
            return {
              '.tag': 'failure',
              failure: {'.tag': 'lookup_failed', lookup_failed: {'.tag': bytes === null ? 'not_closed' : 'not_found'}},
            };
          if (cursor.offset !== bytes.length) throw Error('Wrong byte offset');
          const old = find(commit.path);
          if (commit.mode['.tag'] === 'update' ? old?.rev !== commit.mode.update : Boolean(old))
            return {
              '.tag': 'failure',
              failure: {'.tag': 'path', path: {'.tag': 'conflict', conflict: {'.tag': 'file'}}},
            };
          const value = metadata(put(commit.path, bytes.toString('utf8')));
          sessions.delete(cursor.session_id);
          return {...value, '.tag': 'success'};
        });
        if (lostBatch) {
          lostBatch = false;
          return route.abort('failed');
        }
        return ok({entries: results});
      }
      if (endpoint.endsWith('/move_batch_v2')) {
        if (
          url.host !== 'api.dropboxapi.com' ||
          args.autorename !== false ||
          args.allow_ownership_transfer !== false ||
          !args.entries.length
        )
          throw Error('Invalid move batch');
        if (nextAsyncMove) {
          const options = nextAsyncMove;
          nextAsyncMove = null;
          const id = 'move-job-' + crypto.randomUUID();
          moveJobs.set(id, {entries: structuredClone(args.entries), checks: options.checks});
          if (options.loseLaunch) return route.abort('failed');
          return ok({'.tag': 'async_job_id', async_job_id: id});
        }
        const result = {
          '.tag': 'complete',
          entries: args.entries.map(entry => relocation(entry.from_path, entry.to_path)),
        };
        if (lostMove) {
          lostMove = false;
          return route.abort('failed');
        }
        return ok(result);
      }
      if (endpoint.endsWith('/move_batch/check_v2')) {
        const job = moveJobs.get(args.async_job_id);
        if (!job) return route.fulfill({status: 409, json: {error_summary: 'invalid_async_job_id/'}});
        if (job.checks-- > 0) return ok({'.tag': 'in_progress'});
        return ok(moveResult(job));
      }
      if (endpoint.endsWith('/move_v2')) {
        const value = find(args.from_path);
        if (!value) return missing();
        if (find(args.to_path)) return route.fulfill({status: 409, json: {error_summary: 'to/conflict/'}});
        const prefix = value.path_display;
        for (const [k, e] of [...entries])
          if (e.path_display === prefix || e.path_display.startsWith(prefix + '/')) {
            entries.delete(k);
            e.path_display = args.to_path + e.path_display.slice(prefix.length);
            e.path_lower = key(e.path_display);
            entries.set(e.path_lower, e);
          }
        return ok({metadata: metadata(value)});
      }
      if (endpoint.endsWith('/delete_v2')) {
        const value = find(args.path);
        if (!value) return route.fulfill({status: 409, json: {error_summary: 'path_lookup/not_found/'}});
        if (args.parent_rev && args.parent_rev !== value.rev)
          return route.fulfill({status: 409, json: {error_summary: 'path_lookup/conflict/'}});
        entries.delete(key(value.path_display));
        return ok({metadata: metadata(value)});
      }
      throw Error('Unexpected Dropbox endpoint ' + endpoint);
    } finally {
      active--;
      if (writing) activeWrites--;
    }
  });
  return {
    entries,
    history,
    sessions,
    moveJobs,
    namespaceJobs,
    cursors,
    calls,
    links,
    /** A folder link from another account; `folders` maps link-relative paths to entries. */
    shareForeign(url, {error, folders = {}, ...meta} = {}) {
      foreign.set(
        url,
        error
          ? {error}
          : {
              meta: {
                '.tag': 'folder',
                id: 'id:foreign-' + foreign.size,
                name: 'Kilde',
                url,
                link_permissions: {effective_audience: {'.tag': 'public'}, link_access_level: {'.tag': 'viewer'}},
                ...meta,
              },
              folders,
            },
      );
    },
    find,
    put,
    loseDeleteReply() {
      lostDelete = true;
    },
    loseFoldersReply() {
      lostFolders = true;
    },
    asyncNamespace(kind, checks = 1, loseLaunch = false) {
      namespaceAsync = {kind, checks, loseLaunch};
    },
    finishNamespaceJobs() {
      for (const job of namespaceJobs.values()) namespaceResult(job);
    },
    loseBatchReply() {
      lostBatch = true;
    },
    loseMoveReply() {
      lostMove = true;
    },
    asyncMove(checks = 1, loseLaunch = false) {
      nextAsyncMove = {checks, loseLaunch};
    },
    finishMoves() {
      for (const job of moveJobs.values()) moveResult(job);
    },
    failBatchEntry(path, tag = 'too_many_write_operations', repeat = 1) {
      batchFailure = {path, tag, remaining: repeat};
    },
    failMoveEntry(source, repeat) {
      moveFailure = {source, remaining: repeat};
    },
    latency(ms) {
      latency = ms;
      maximum = 0;
    },
    maximum: () => maximum,
    throttled: () => rateCount,
    limitConcurrentWrites() {
      limitWrites = true;
    },
    resetCursors() {
      cursors.clear();
    },
    rename(from, to) {
      const value = find(from);
      const prefix = value.path_display;
      for (const [k, e] of [...entries])
        if (e.path_display === prefix || e.path_display.startsWith(prefix + '/')) {
          entries.delete(k);
          e.path_display = to + e.path_display.slice(prefix.length);
          e.path_lower = key(e.path_display);
          entries.set(e.path_lower, e);
        }
    },
    fault(endpoint, status, skip = 0, {repeat = 1, retryAfter = 0, reason = 'too_many_write_operations', path} = {}) {
      fault = {endpoint, status, skip, remaining: repeat, retryAfter, reason, path};
    },
    clearFault() {
      fault = null;
    },
    hold(endpoint, all = false, path) {
      let release;
      const resolve = new Promise(r => (release = r)),
        waiting = {endpoint, resolve, all, path};
      hold = waiting;
      return () => {
        if (hold === waiting) hold = null;
        release();
      };
    },
  };
}
