import {rangeControl, switchControl} from './controls.ts';
import {byId} from './dom.ts';
import {applyPreferences} from './preferences.ts';
import {defaultPreferences, readPreferences, savePreferences} from '../storage/preferences.ts';

/** Visningsvalgene på Innstillinger: skriftstørrelse, akkordskjema og dynamikkprofil. */
export function startDisplaySettings() {
  const status = byId('settings-status'),
    controls = byId('display-controls');
  let preferences = {...defaultPreferences};
  try {
    preferences = readPreferences(__APP_ENV__.namespace);
  } catch {
    status.textContent = 'Visningsvalg kunne ikke hentes. Endringer gjelder nå, men kan ikke loves husket.';
  }
  applyPreferences(preferences);
  const sizeControl = rangeControl({
    id: 'font-size',
    outputId: 'font-value',
    label: 'Skriftstørrelse',
    unit: 'px',
    min: 16,
    max: 36,
    step: 1,
    value: preferences.fontSize,
    change: () => update(),
  });
  const gridsControl = switchControl('show-grids', 'Vis akkordskjema', () => update());
  const dynamicsControl = switchControl('show-dynamics', 'Vis dynamikkprofil', () => update());
  gridsControl.input.checked = preferences.showGrids;
  dynamicsControl.input.checked = preferences.showDynamics;
  controls.insertBefore(sizeControl.element, status);
  controls.insertBefore(gridsControl.element, status);
  controls.insertBefore(dynamicsControl.element, status);
  function update() {
    preferences = {
      theme: 'dark',
      fontSize: Number(sizeControl.input.value),
      showDynamics: dynamicsControl.input.checked,
      showGrids: gridsControl.input.checked,
    };
    applyPreferences(preferences);
    try {
      savePreferences(__APP_ENV__.namespace, preferences);
      status.textContent = '';
    } catch {
      status.textContent = 'Visningen er endret, men valget kunne ikke lagres til neste oppstart.';
    }
  }
}
