import './style.css';
import {startSongbook} from './ui/songbook.ts';
startSongbook();
import {registerSW} from 'virtual:pwa-register';

const env = __APP_ENV__;
document.documentElement.dataset.channel = env.channel;
const offline = document.querySelector<HTMLElement>('#offline-status')!;
const updateStatus = document.querySelector<HTMLElement>('#update-status')!;
const updateButton = document.querySelector<HTMLButtonElement>('#update')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
let registration: ServiceWorkerRegistration | undefined;
let updateAvailable = false;

const showConnection = () => {
  connection.textContent = navigator.onLine ? 'Nettverk tilgjengelig' : 'Uten nett';
};
showConnection();
window.addEventListener('online', showConnection);
window.addEventListener('offline', showConnection);

function ready() {
  offline.textContent = 'Klart for bruk uten nett';
  offline.dataset.ready = 'true';
}

if (import.meta.env.DEV) {
  offline.textContent = 'Offline-oppsettet prøves i produksjonsbygget.';
  updateButton.hidden = true;
} else if ('serviceWorker' in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onOfflineReady() {
      void navigator.serviceWorker.ready.then(reg => {
        if (new URL(reg.scope).pathname === env.base) ready();
      });
    },
    onNeedRefresh() {
      updateAvailable = true;
      updateButton.textContent = 'Oppdater appen';
      updateStatus.textContent = 'En ny versjon er klar.';
    },
    onRegisteredSW(_url, reg) {
      registration = reg;
      if (!reg) offline.textContent = 'Offline-oppsettet kunne ikke fullføres i denne nettleseren.';
      if (reg?.active?.state === 'activated' && new URL(reg.scope).pathname === env.base) ready();
    },
    onRegisterError() {
      offline.textContent = 'Offline-oppsettet kunne ikke fullføres. Prøv igjen mens du er på nett.';
    },
  });
  updateButton.addEventListener('click', async () => {
    updateButton.disabled = true;
    try {
      if (updateAvailable) {
        await updateSW(true);
      } else if (!navigator.onLine) {
        updateStatus.textContent = 'Koble til nett for å se etter oppdateringer.';
      } else if (registration) {
        await registration.update();
        if (!registration.installing && !registration.waiting && !updateAvailable) updateStatus.textContent = 'Du har siste tilgjengelige versjon.';
      } else {
        updateStatus.textContent = 'Offline-oppsettet starter fortsatt. Prøv igjen om litt.';
      }
    } catch {
      updateStatus.textContent = 'Kunne ikke hente oppdateringen. Prøv igjen når nettet er tilgjengelig.';
    } finally {updateButton.disabled = false;}
  });
} else {
  offline.textContent = 'Denne nettleseren støtter ikke offline-oppsettet.';
  updateButton.hidden = true;
}
