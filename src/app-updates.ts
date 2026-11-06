/** Native lifecycle handling also covers updates during the first app session. */
export function startAppUpdates() {
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
  const workerURL = new URL(`${env.base}sw.js`, location.origin).href;
  let registration: ServiceWorkerRegistration | undefined;
  let checking = false, applying = false, reloadAvailable = false;
  let controller = workers.controller;
  let activationTarget: ServiceWorker | null = null;
  let activationTimer: ReturnType<typeof setTimeout> | undefined;
  const watched = new WeakSet<ServiceWorker>();
  const matches = (worker: ServiceWorker | null) => worker?.scriptURL === workerURL;
  function offerUpdate() {
    if (applying) return;
    notice.hidden = false;
    noticeText.textContent = 'En ny versjon er klar.';
    button.textContent = 'Oppdater appen';
    status.textContent = 'En ny versjon er klar.';
  }
  function inspect() {
    if (registration?.active?.state === 'activated') ready();
    if (registration?.waiting) offerUpdate();
    const installing = registration?.installing;
    if (!installing || watched.has(installing)) return;
    watched.add(installing);
    const changed = () => {
      if (installing.state === 'installed') {
        if (registration?.waiting) offerUpdate();
      } else if (installing.state === 'activated') ready();
      else if (installing.state === 'redundant' && !registration?.waiting) {
        status.textContent = 'Oppdateringen kunne ikke lastes ned. Prøv igjen når nettet er tilgjengelig.';
      }
    };
    installing.addEventListener('statechange', changed); changed();
  }
  workers.addEventListener('controllerchange', () => {
    const next = workers.controller;
    if (!matches(next) || next === controller) return;
    const hadController = matches(controller);
    controller = next;
    if (applying && next === activationTarget) {
      clearTimeout(activationTimer); location.reload();
    } else if (hadController && !applying) {
      // Another tab in this environment activated it. This page still has old JS.
      reloadAvailable = true; offerUpdate();
    }
  });
  async function check(manual = false) {
    inspect();
    if (checking || applying || registration?.waiting || reloadAvailable) return;
    checking = true;
    if (manual) {button.disabled = true; status.textContent = 'Ser etter oppdatering…';}
    try {
      if (!registration) {
        const existing = await workers.getRegistration(env.base);
        if (existing && new URL(existing.scope).pathname === env.base) {
          registration = existing; registration.addEventListener('updatefound', inspect); inspect();
        }
      }
      if (!navigator.onLine) {
        if (manual) status.textContent = 'Koble til nett for å se etter oppdateringer.';
        if (!registration) offline.textContent = 'Åpne appen på nett for å gjøre den klar for bruk uten nett.';
        return;
      }
      if (!registration) {
        registration = await workers.register(workerURL, {scope: env.base, updateViaCache: 'none'});
        if (new URL(registration.scope).pathname !== env.base) throw new Error('Feil worker-scope.');
        registration.addEventListener('updatefound', inspect);
      } else await registration.update();
      inspect();
      if (manual && !registration.waiting && !reloadAvailable) {
        status.textContent = registration.installing ? 'Laster ned oppdateringen…' : 'Du har siste tilgjengelige versjon.';
      }
    } catch {
      if (!registration) offline.textContent = 'Offline-oppsettet kunne ikke fullføres. Prøv igjen mens du er på nett.';
      if (manual) status.textContent = 'Kunne ikke hente oppdateringen. Prøv igjen når nettet er tilgjengelig.';
    } finally {checking = false; if (!applying) button.disabled = false;}
  }
  async function applyUpdate() {
    if (applying) return;
    if (reloadAvailable) {location.reload(); return;}
    const waiting = registration?.waiting;
    if (!waiting) {await check(true); return;}
    activationTarget = waiting;
    applying = true; button.disabled = true; noticeButton.disabled = true;
    status.textContent = noticeText.textContent = 'Tar i bruk den nye versjonen…';
    try {
      // Workbox's generated worker handles this message; reload only after takeover.
      waiting.postMessage({type: 'SKIP_WAITING'});
      activationTimer = setTimeout(() => {
        if (workers.controller === activationTarget) {location.reload(); return;}
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
  // A long-running reading session must discover a new build without navigation.
  setInterval(checkWhenVisible, 60_000);
  void check();
}
