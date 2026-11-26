import {localSettings} from './local-settings.ts';
export interface Preferences {
  theme: 'dark';
  fontSize: number;
  showDynamics: boolean;
  showGrids: boolean;
}
export const defaultPreferences: Preferences = {theme: 'dark', fontSize: 22, showDynamics: true, showGrids: true};
export function readPreferences(namespace: string): Preferences {
  const raw = localSettings(namespace, localStorage).get('display');
  if (!raw) return {...defaultPreferences};
  const value = JSON.parse(raw);
  return {
    theme: 'dark',
    showDynamics: value.showDynamics !== false,
    showGrids: value.showGrids !== false,
    fontSize: Number.isInteger(value.fontSize) && value.fontSize >= 16 && value.fontSize <= 36 ? value.fontSize : 22,
  };
}
export function savePreferences(namespace: string, value: Preferences) {
  localSettings(namespace, localStorage).set('display', JSON.stringify(value));
}
