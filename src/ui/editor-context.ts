import type {EditSession} from '../domain/edit-session.ts';
import type {Song, SongPersonal} from '../core/song.ts';
import type {ElementChoice} from './editor-selection.ts';

export interface Point {
  x: number;
  y: number;
}

/** En åpen verdikontroll (D-familien) for ett felt. */
export interface ValueRequest {
  name: string;
  icon: string;
  anchor: HTMLElement;
  start: string;
  apply: (value: string, submitted: boolean) => void;
  numeric?: {min: number; max: number};
  point?: Point;
}

/**
 * Det sangeditoren gir delmodulene sine. Editoren eier tilstanden (verktøy, valg, åpen kontroll);
 * delmodulene leser den og ber om endringer gjennom disse funksjonene.
 */
export interface EditorContext {
  session: EditSession;
  toolbar: HTMLElement;
  tool(): string | undefined;
  setTool(value?: string): void;
  selected(): ElementChoice | undefined;
  select(node: HTMLElement): void;
  selectable(target: Element): HTMLElement | undefined;
  removeSelected(): void;
  update(fn: (state: SongPersonal) => SongPersonal): void;
  original(next: Song): void;
  value(request: ValueRequest): void;
  note(anchor: HTMLElement, point?: Point): void;
  moveChord(start: number, line: number, offset: number): void;
  run(name: string, button: HTMLElement): void;
  save(): void;
  showError(text: string): void;
}

/** Den synlige sanglinjen nærmest den loddrette posisjonen `y`. */
export function rowAt(root: HTMLElement, y: number) {
  return [...root.querySelectorAll<HTMLElement>('[data-source-line],[data-note-line]')]
    .filter(r => !r.closest('[hidden]') && r.getClientRects().length)
    .reduce<HTMLElement | undefined>((best, r) => {
      const distance = (n: HTMLElement) => {
        const q = n.getBoundingClientRect();
        return Math.max(q.top - y, 0, y - q.bottom);
      };
      return !best || distance(r) < distance(best) ? r : best;
    }, undefined);
}
