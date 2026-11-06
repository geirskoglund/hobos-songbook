import './style.css';
import {startSongbook} from './ui/songbook.ts';
import {startAppUpdates} from './app-updates.ts';

document.documentElement.dataset.channel = __APP_ENV__.channel;
startSongbook();
startAppUpdates();
const connection = document.querySelector<HTMLElement>('#connection')!;
const showConnection = () => {connection.textContent = navigator.onLine ? 'Nettverk tilgjengelig' : 'Uten nett';};
showConnection();
window.addEventListener('online', showConnection);
window.addEventListener('offline', showConnection);
