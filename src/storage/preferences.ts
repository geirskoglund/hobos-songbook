import {localSettings} from './local-settings.ts';
export interface Preferences {theme: 'dark' | 'light'; fontSize: number}
export const defaultPreferences: Preferences = {theme: 'dark', fontSize: 22};
export function readPreferences(namespace: string): Preferences {
  const raw = localSettings(namespace, localStorage).get('display');
  if (!raw) return {...defaultPreferences};
  const value = JSON.parse(raw);
  return {theme: value.theme === 'light' ? 'light' : 'dark',
    fontSize: Number.isInteger(value.fontSize) && value.fontSize >= 16 && value.fontSize <= 36 ? value.fontSize : 22};
}
export function savePreferences(namespace: string, value: Preferences) {
  localSettings(namespace, localStorage).set('display', JSON.stringify(value));
}
export function applyPreferences(value: Preferences) {
  document.documentElement.dataset.theme = value.theme;
  document.documentElement.style.setProperty('--song-size', `${value.fontSize}px`);
}
