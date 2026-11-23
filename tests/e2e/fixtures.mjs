import {test as base} from '@playwright/test';
import {e2eOrigin} from '../../scripts/e2e-ports.mjs';

export * from '@playwright/test';

/** Points each worker at its own test server, so app version state is never shared. */
export const test = base.extend({
  baseURL: async ({}, use, testInfo) => {
    await use(e2eOrigin(testInfo.parallelIndex));
  },
});
