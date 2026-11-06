import {defineConfig, chromium} from '@playwright/test';
import {existsSync} from 'node:fs';

const executablePath = process.env.CHROMIUM_PATH || [chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/google-chrome', '/opt/google/chrome/chrome'].find(path => existsSync(path));
if (!executablePath) throw new Error('Chromium mangler. Kjør npx playwright install chromium, eller sett CHROMIUM_PATH.');
export default defineConfig({
  testDir: './tests/e2e', workers: 1, fullyParallel: false, timeout: 60000,
  use: {baseURL: 'http://127.0.0.1:4173', browserName: 'chromium',
    launchOptions: {executablePath, args: ['--no-sandbox']}, screenshot: 'only-on-failure', trace: 'retain-on-failure'},
  webServer: {command: 'node scripts/e2e-server.mjs', url: 'http://127.0.0.1:4173/__test__/ready', reuseExistingServer: false},
});
