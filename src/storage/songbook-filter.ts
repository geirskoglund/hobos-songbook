import {localSettings} from './local-settings.ts';
export function readSongbookFilter(namespace: string): string | null {
  return localSettings(namespace, localStorage).get('songbook-filter') || null;
}
export function saveSongbookFilter(namespace: string, id: string | null) {
  localSettings(namespace, localStorage).set('songbook-filter', id ?? '');
}
