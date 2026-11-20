export async function copyText(text: string, mount: HTMLElement) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error();
    await navigator.clipboard.writeText(text);
  } catch {
    const focus = document.activeElement;
    const field = document.createElement('textarea');
    field.value = text;
    field.readOnly = true;
    field.className = 'sr-only';
    mount.append(field);
    try {
      field.select();
      if (!document.execCommand('copy')) throw new Error('Utklippstavlen er utilgjengelig.');
    } finally {
      field.remove();
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus({preventScroll: true});
    }
  }
}
