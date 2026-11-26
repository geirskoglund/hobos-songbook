import type {Preferences} from '../storage/preferences.ts';
import {requestLayout} from './layout.ts';
export function applyPreferences(value: Preferences) {
  document.documentElement.dataset.dynamics = value.showDynamics ? 'on' : 'off';
  document.documentElement.dataset.grids = value.showGrids ? 'on' : 'off';
  document.documentElement.dataset.theme = value.theme;
  document.documentElement.style.setProperty('--song-size', `${value.fontSize}px`);
  requestLayout();
}
