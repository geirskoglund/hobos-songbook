// Each Playwright worker gets its own test server port, so the server's app version
// state (reset/update) and the browser origin are never shared between workers.
export const e2eBasePort = 4173;
export const e2eMaxWorkers = 8;

export function e2eOrigin(parallelIndex) {
  if (!Number.isInteger(parallelIndex) || parallelIndex < 0 || parallelIndex >= e2eMaxWorkers)
    throw new Error(`E2E-testene støtter høyst ${e2eMaxWorkers} arbeidere.`);
  return `http://127.0.0.1:${e2eBasePort + parallelIndex}`;
}
