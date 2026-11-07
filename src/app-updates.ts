import {workerBuild} from './worker-build.ts';
import type {AppEnvironment} from './environment.ts';

export function startAppUpdates(beforeReload: (focusId: string | null) => void | Promise<void>) {
  const env = __APP_ENV__;
  const offline = document.querySelector<HTMLElement>('#offline-status')!;
  const status = document.querySelector<HTMLElement>('#update-status')!;
  const button = document.querySelector<HTMLButtonElement>('#update')!;
  const notice = document.querySelector<HTMLElement>('#update-notice')!;
  const noticeButton = document.querySelector<HTMLButtonElement>('#apply-update')!;
  const noticeText = document.querySelector<HTMLElement>('#update-notice-text')!;
  const ready = () => {offline.textContent = 'Klart for bruk uten nett'; offline.dataset.ready = 'true';};
  if (import.meta.env.DEV) {
    offline.textContent = 'Offline-oppsettet prøves i produksjonsbygget.'; button.hidden = true; return;
  }
  if (!('serviceWorker' in navigator)) {
    offline.textContent = 'Denne nettleseren støtter ikke offline-oppsettet.'; button.hidden = true; return;
  }
  const workers = navigator.serviceWorker;
  const initialController = workers.controller;
  const workerURL = new URL(`${env.base}sw.js`, location.origin).href;
  let registration: ServiceWorkerRegistration | undefined;
  let checking = false, applying = false, reloadAvailable = false, manualRequested = false;
  let announced: ServiceWorker | null = null, activationTarget: ServiceWorker | null = null;
  let inspection = 0;
  let activationTimer: ReturnType<typeof setTimeout> | undefined;
  let reloadFocusId: string | null = null;
  const watched = new WeakSet<ServiceWorker>();
  const builds = new WeakMap<ServiceWorker, Promise<AppEnvironment | null>>();
  let reloading = false;
  const reload = async () => {
    if (reloading) return;
    reloading = true;
    try {await beforeReload(reloadFocusId); location.reload();}
    catch (error) {
      reloading = false; applying = false; button.disabled = false; noticeButton.disabled = false;
      status.textContent = noticeText.textContent = error instanceof Error ? error.message : 'Kunne ikke lagre endringene før oppdatering. Prøv igjen.';
    }
  };
  const matches = (worker: ServiceWorker | null) => worker?.scriptURL === workerURL;
  function clearNotice() {
    if (announced || !notice.hidden) status.textContent = '';
    announced = null; reloadAvailable = false; notice.hidden = true;
    noticeText.textContent = '';
    button.textContent = 'Se etter oppdatering';
  }
  async function inspect() {
    if (registration?.active?.state === 'activated') ready();
    const installing = registration?.installing;
    if (installing && !watched.has(installing)) {
      watched.add(installing);
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' || installing.state === 'activated') void inspect();
        else if (installing.state === 'redundant' && !registration?.waiting) {
          status.textContent = 'Oppdateringen kunne ikke lastes ned. Prøv igjen når nettet er tilgjengelig.';
        }
      });
    }
    const candidate = registration?.waiting ?? (workers.controller !== initialController && matches(workers.controller) ? workers.controller : null);
    if (applying) return 'none';
    if (!candidate) {clearNotice(); return 'none';}
    const epoch = ++inspection;
    let build = builds.get(candidate);
    if (!build) {build = workerBuild(candidate, env); builds.set(candidate, build);}
    const info = await build;
    if (!info) builds.delete(candidate); // A timeout is not proof of any version; retry later.
    if (epoch !== inspection || applying || candidate !== (registration?.waiting ?? workers.controller)) return 'stale';
    if (!info) {clearNotice(); return 'unknown';}
    if (info.sha === env.sha && info.pr === env.pr) {clearNotice(); return 'same';}
    announced = candidate; reloadAvailable = registration?.waiting !== candidate;
    notice.hidden = false; noticeText.textContent = status.textContent = 'En ny versjon er klar.';
    button.textContent = 'Oppdater appen';
    return 'different';
  }
  workers.addEventListener('controllerchange', () => {
    if (!matches(workers.controller)) return;
    if (applying && workers.controller === activationTarget) {
      clearTimeout(activationTimer); reload();
    } else void inspect();
  });
  async function check(manual = false) {
    if (applying) return;
    if (checking) {
      if (manual) {
        manualRequested = true; button.disabled = true; status.textContent = 'Ser etter oppdatering…';
      }
      return;
    }
    checking = true;
    if (manual) {button.disabled = true; status.textContent = 'Ser etter oppdatering…';}
    try {
      if (!registration) {
        const existing = await workers.getRegistration(env.base);
        if (existing && new URL(existing.scope).pathname === env.base) {
          registration = existing; registration.addEventListener('updatefound', () => {void inspect();});
          void inspect();
        }
      }
      if (navigator.onLine) {
        if (!registration) {
          registration = await workers.register(workerURL, {scope: env.base, updateViaCache: 'none'});
          if (new URL(registration.scope).pathname !== env.base) throw new Error('Feil worker-scope.');
          registration.addEventListener('updatefound', () => {void inspect();});
        } else await registration.update();
      } else if (!registration) offline.textContent = 'Åpne appen på nett for å gjøre den klar for bruk uten nett.';
      const result = await inspect();
      if ((manual || manualRequested) && !announced && result !== 'stale') {
        status.textContent = result === 'unknown' ? 'Kunne ikke bekrefte versjonen. Prøv igjen.' :
          !navigator.onLine ? 'Koble til nett for å se etter oppdateringer.' :
          registration?.installing ? 'Laster ned oppdateringen…' : 'Du har siste tilgjengelige versjon.';
      }
    } catch {
      if (!registration) offline.textContent = 'Offline-oppsettet kunne ikke fullføres. Prøv igjen mens du er på nett.';
      if (manual || manualRequested) status.textContent = 'Kunne ikke hente oppdateringen. Prøv igjen når nettet er tilgjengelig.';
    } finally {checking = false; manualRequested = false; if (!applying) button.disabled = false;}
  }
  async function applyUpdate() {
    if (applying) return;
    if (!announced) {await check(true); return;}
    await inspect(); // Recheck a notice that may have been superseded in another tab.
    if (!announced) return;
    reloadFocusId = document.activeElement?.id || null;
    if (reloadAvailable && workers.controller === announced) {reload(); return;}
    if (registration?.waiting !== announced) {await check(true); return;}
    activationTarget = announced;
    applying = true; button.disabled = true; noticeButton.disabled = true;
    status.textContent = noticeText.textContent = 'Tar i bruk den nye versjonen…';
    try {
      activationTarget.postMessage({type: 'SKIP_WAITING'});
      activationTimer = setTimeout(() => {
        if (workers.controller === activationTarget) {reload(); return;}
        applying = false; button.disabled = false; noticeButton.disabled = false;
        status.textContent = noticeText.textContent = 'Oppdateringen er ikke tatt i bruk ennå. Prøv igjen.';
      }, 15000);
    } catch {
      applying = false; button.disabled = false; noticeButton.disabled = false;
      status.textContent = noticeText.textContent = 'Kunne ikke ta i bruk oppdateringen. Prøv igjen.';
    }
  }
  button.addEventListener('click', () => {void applyUpdate();});
  noticeButton.addEventListener('click', () => {void applyUpdate();});
  const checkWhenVisible = () => {if (document.visibilityState === 'visible') void check();};
  window.addEventListener('online', checkWhenVisible);
  window.addEventListener('focus', checkWhenVisible);
  document.addEventListener('visibilitychange', checkWhenVisible);
  setInterval(checkWhenVisible, 60_000);
  void check();
}
