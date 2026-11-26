/** Lager et element med valgfri tekst og klasse. */
export const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

export const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
