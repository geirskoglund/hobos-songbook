import {defineConfig, chromium} from '@playwright/test';
import {existsSync} from 'node:fs';
import {e2eOrigin} from './scripts/e2e-ports.mjs';

const executablePath =
  process.env.CHROMIUM_PATH ||
  [chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/google-chrome', '/opt/google/chrome/chrome'].find(path =>
    existsSync(path),
  );
if (!executablePath)
  throw new Error('Chromium mangler. Kjør npx playwright install chromium, eller sett CHROMIUM_PATH.');
export default defineConfig({
  testDir: './tests/e2e',
  // Files run in parallel, each worker against its own server port (tests/e2e/fixtures.mjs sets baseURL).
  // Tests within a file still run in order.
  workers: 4,
  fullyParallel: false,
  timeout: 60000,
  use: {
    browserName: 'chromium',
    launchOptions: {executablePath, args: ['--no-sandbox']},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `${e2eOrigin(0)}/__test__/ready`,
    reuseExistingServer: false,
  },
});
