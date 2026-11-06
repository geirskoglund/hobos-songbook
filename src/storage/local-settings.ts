/** Small local boundary for future preferences. No database, songs or provider dependency yet. */
export function localSettings(namespace: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  if (!['hobos-songbook-production', 'hobos-songbook-test'].includes(namespace)) throw new Error('Ugyldig lagringsmiljø.');
  const key = (name: string) => `${namespace}:${name}`;
  return {
    get: (name: string) => storage.getItem(key(name)),
    set: (name: string, value: string) => storage.setItem(key(name), value),
    remove: (name: string) => storage.removeItem(key(name)),
  };
}
