// Replaces navigator.clipboard with an in-page stub so tests never touch the system clipboard,
// which also differs per OS (Windows turns \n into \r\n). Call before the page loads; the stub is
// installed again on every load.
export async function stubClipboard(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => {
          window.copiedText = text;
        },
      },
    });
  });
}

export function copiedText(page) {
  return page.evaluate(() => window.copiedText ?? null);
}
