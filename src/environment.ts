export type Channel = 'production' | 'test';
export interface AppEnvironment {
  version: 1;
  kind: 'app';
  channel: Channel;
  sha: string;
  pr: number | null;
  name: string;
  base: string;
  namespace: string;
}

/** One stable identity per environment; PR and commit never affect persisted names. */
export function environment(channel: string, sha: string, pr: string = ''): AppEnvironment {
  if (channel !== 'production' && channel !== 'test') throw new Error('Ukjent appmiljø.');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Bygget krever en full kilde-SHA.');
  if (pr && (!/^[1-9][0-9]*$/.test(pr) || !Number.isSafeInteger(Number(pr)))) throw new Error('Ugyldig PR-nummer.');
  if (channel === 'production' && pr) throw new Error('Produksjon kan bare bygges fra master.');
  return {version: 1, kind: 'app', channel, sha, pr: pr ? Number(pr) : null,
    name: channel === 'production' ? "Hobo's Songbook" : "Hobo's Songbook Test",
    base: `/hobos-songbook/${channel === 'production' ? 'app' : 'test'}/`,
    namespace: `hobos-songbook-${channel === 'production' ? 'production' : 'test'}`};
}
