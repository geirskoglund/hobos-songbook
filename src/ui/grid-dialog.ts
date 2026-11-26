import {textArea} from './controls.ts';
import {dialogFrame, dialogFooter, openDialog} from './dialog.ts';
import {overlayWidth, placeOverlay} from './layout.ts';
import {shiftGridText, sharedGridText, validGrid} from '../domain/personal.ts';
import {sourceBlocks, patchSong, lineEnding, mergeRawSource} from '../domain/source-edit.ts';
import type {EditSession} from '../domain/edit-session.ts';
import type {Song, SongPersonal} from '../core/song.ts';

/** Felles skjema mangler en entydig slutt og kan ikke redigeres her. */
export const gridWithoutEnd = (session: EditSession) =>
  sourceBlocks(session.song.original, 'grid').some(block => !block.end);

/** Dialog for felles (i originalteksten) eller personlig akkordskjema, vist med capo trukket fra. */
export function openGridDialog(
  session: EditSession,
  anchor: HTMLElement,
  shared: boolean,
  write: {
    update: (fn: (state: SongPersonal) => SongPersonal) => void;
    original: (next: Song) => void;
    closed: () => void;
  },
) {
  const capo = session.personal.capo ?? 0,
    source = shared
      ? sharedGridText(session.song.original)
      : session.personal.chordGrid || sharedGridText(session.song.original),
    shown = shiftGridText(source, -capo);
  const parts = [
    ...shown.matchAll(
      /(^[ \t]*\{(?:sog|start_of_grid)[^\r\n]*\}[ \t]*(?:\r\n|\r|\n))([\s\S]*?)(^[ \t]*\{(?:eog|end_of_grid)\}[^\r\n]*)/gim,
    ),
  ].map(m => ({
    header: m[1],
    body: m[2].replace(/\r?\n$/, ''),
    footer: m[3],
  }));
  if (!parts.length)
    parts.push({
      header: `{sog}${lineEnding(session.song.original)}`,
      body: shown,
      footer: '{eog}',
    });
  const box = dialogFrame(
    `${shared ? 'Felles akkordskjema' : 'Personlig akkordskjema'}${capo ? `, capo ${capo}` : ''}`,
    'edit-popup popup-grid',
  );
  const heading = document.createElement('h2');
  heading.textContent = box.getAttribute('aria-label');
  box.append(heading);
  const inputs = parts.map((part, i) => {
    const input = textArea(`grid-${i}`, part.body, parts.length > 1 ? `Skjematekst ${i + 1}` : 'Skjematekst');
    box.append(input);
    return input;
  });
  const error = document.createElement('p');
  error.className = 'field-error';
  error.setAttribute('role', 'alert');
  box.append(error);
  const dirty = () => inputs.some((input, i) => input.value !== parts[i].body.replace(/\r\n|\r/g, '\n'));
  const close = () => lifecycle.close();
  const confirm = () => {
    if (!dirty()) {
      close();
      return;
    }
    const ending = lineEnding(session.song.original),
      text = parts
        .map((p, i) =>
          inputs[i].value.trim() ? p.header + mergeRawSource(p.body, inputs[i].value) + ending + p.footer : '',
        )
        .filter(Boolean)
        .join(ending);
    if (
      text &&
      inputs.some(
        (input, i) => input.value.trim() && !validGrid(parts[i].header + input.value + ending + parts[i].footer),
      )
    ) {
      error.textContent = 'Skriv et skjema med taktstreker.';
      return;
    }
    const stored = shiftGridText(text, capo);
    if (shared) {
      const blocks = sourceBlocks(session.song.original, 'grid');
      if (blocks.length)
        write.original(
          patchSong(
            session.song,
            blocks.flatMap((b, i) =>
              inputs[i]?.value === parts[i].body.replace(/\r\n|\r/g, '\n')
                ? []
                : [
                    {
                      start: b.start.start,
                      end: b.end?.end ?? session.song.original.length,
                      text: inputs[i]?.value.trim()
                        ? shiftGridText(
                            parts[i].header + mergeRawSource(parts[i].body, inputs[i].value) + ending + parts[i].footer,
                            capo,
                          ) + (b.end?.ending ?? '')
                        : '',
                    },
                  ],
            ),
          ),
        );
      else if (stored)
        write.original(
          patchSong(session.song, [
            {
              start: session.song.original.startsWith('\uFEFF') ? 1 : 0,
              end: session.song.original.startsWith('\uFEFF') ? 1 : 0,
              text: stored + ending,
            },
          ]),
        );
    } else
      write.update(state => ({
        ...state,
        chordGrid: stored || undefined,
      }));
    close();
  };
  const actions = dialogFooter([
    {id: 'cancel', label: 'Avbryt', icon: 'avbryt', run: close},
    {id: 'confirm', label: 'OK', icon: 'ok', primary: true, run: confirm},
  ]);
  box.append(actions);
  const lifecycle = openDialog(box, {
    opener: anchor,
    focus: inputs[0],
    place: () =>
      placeOverlay(box, undefined, {
        width: overlayWidth('grid'),
        align: 'center',
        height: 0.8,
      }),
    outside: true,
    closed: write.closed,
  });
  return {close, dirty};
}
