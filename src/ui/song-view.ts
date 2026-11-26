import {paintAnnotations} from './annotations.ts';
import {createChartDock} from './chart-dock.ts';
import {element} from './dom.ts';
import {renderContent, type DynamicsContext} from './song-content.ts';
import type {parseChordPro} from '../domain/chordpro.ts';
import {gripKey, transposeChord, transposeGrid} from '../domain/personal.ts';
import {selectSongGrid} from '../domain/song-grid.ts';
import type {Song, SongPersonal} from '../core/song.ts';

export interface SongViewOptions {
  song: Song;
  parsed: ReturnType<typeof parseChordPro>;
  /** Personlig tilstand slik den er når visningen tegnes. */
  personal: SongPersonal;
  /** Personlig tilstand slik den er nå, også etter at et refrengvalg er lagret. */
  current: () => SongPersonal;
  /** Redigeringsverktøylinjen, når sangen vises i redigeringsmodus. */
  toolbar?: HTMLElement;
  chartReleased: boolean;
  chartChanged: (released: boolean) => void;
  /** Lagrer om en gjentatt refrengforekomst skal vises utfoldet. */
  saveChorus: (occurrence: string, expanded: boolean) => Promise<void>;
  chorusSaved: () => void;
  chorusFailed: () => void;
}

/** Tegner sangen i `article`: tittel, metadata, akkordskjema og sangtekst med refreng. */
export function renderSongView(article: HTMLElement, options: SongViewOptions) {
  const {song, parsed, personal, current, toolbar} = options,
    editing = Boolean(toolbar);
  article.replaceChildren();
  const title = element('h1', parsed.title);
  title.id = 'song-title';
  title.tabIndex = -1;
  article.append(title);
  const metadata = element('div', undefined, 'song-metadata');
  if (parsed.key) {
    const key = element('span', parsed.key, 'song-key');
    key.setAttribute('aria-label', `Toneart: ${parsed.key}`);
    metadata.append(key);
  }
  const time = element('span', parsed.time, 'song-key');
  time.setAttribute('aria-label', `Takt: ${parsed.time}`);
  metadata.append(time);
  article.append(metadata);
  let disposeDock = () => {};
  let chartReleased = options.chartReleased;
  const chartArea = element('div');
  chartArea.className = 'chart-area';
  article.append(chartArea);
  if (toolbar) article.prepend(toolbar);
  showMetadata();
  showChart();
  function showMetadata() {
    const state = current();
    if (state.capo || editing) {
      const key = gripKey(parsed.key, state.capo ?? 0);
      metadata.append(
        element('span', state.capo ? `Capo ${state.capo}${key ? `: ${key}` : ''}` : 'Uten capo', 'song-key'),
      );
    }
    if (state.tuning || editing)
      metadata.append(element('span', state.tuning || 'Standard stemming', 'song-key song-tuning'));
  }
  function showChart() {
    const state = current(),
      capo = state.capo ?? 0;
    const chosen = selectSongGrid(parsed, state);
    if (chosen) {
      const dock = createChartDock(
        chosen.grids.map(grid => transposeGrid(grid, capo)),
        chosen.source,
        {
          sticky: !editing && !chartReleased,
          interactive: !editing,
          change: sticky => {
            chartReleased = !sticky;
            options.chartChanged(chartReleased);
          },
        },
      );
      chartArea.append(dock.element);
      disposeDock = dock.dispose;
    }
  }
  const capo = personal.capo ?? 0;
  const body = element('div');
  body.id = 'song-body';
  article.append(body);
  const dynamicsContext: DynamicsContext = {level: 3, chord: value => transposeChord(value, capo)};
  for (const block of parsed.blocks) {
    dynamicsContext.occurrence = block.kind === 'reference' ? block.occurrence : 'source';
    if (block.kind === 'chorus') {
      const section = element('section', undefined, 'chorus');
      section.dataset.chorusStart = String(block.sourceLine);
      const text = element('div', undefined, 'chorus-text');
      text.append(renderContent(block.content, dynamicsContext));
      const heading = element('h2', 'Refreng');
      heading.dataset.sourceLine = String(block.sourceLine);
      section.append(heading, text);
      body.append(section);
    } else if (block.kind === 'reference') {
      if (!block.content) {
        const missing = element('section', undefined, 'chorus reference'),
          heading = element('h2', 'Refreng');
        missing.dataset.referenceLine = heading.dataset.sourceLine = block.occurrence.replace('line:', '');
        missing.append(heading);
        body.append(missing);
        continue;
      }
      const section = element('section', undefined, 'chorus reference');
      section.dataset.referenceLine = block.occurrence.replace('line:', '');
      const heading = element('h2'),
        button = element('button', 'Refreng');
      button.type = 'button';
      heading.dataset.sourceLine = block.occurrence.replace('line:', '');
      button.setAttribute('aria-label', 'Refreng');
      const text = element('div', undefined, 'chorus-text');
      text.id = `chorus-${block.occurrence.replace(':', '-')}`;
      text.append(renderContent(block.content, dynamicsContext));
      dynamicsContext.spokenLevel = undefined; // The following content stays accessible when this body is collapsed.
      let expanded = !editing && personal.chorus[block.occurrence] === true;
      const reflect = () => {
        button.setAttribute('aria-expanded', String(expanded));
        text.hidden = !expanded;
      };
      button.setAttribute('aria-controls', text.id);
      reflect();
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await options.saveChorus(block.occurrence, !expanded);
          expanded = !expanded;
          reflect();
          paintAnnotations(body, song, current());
          options.chorusSaved();
        } catch {
          options.chorusFailed();
        } finally {
          button.disabled = false;
        }
      });
      if (editing) heading.textContent = 'Refreng';
      else heading.append(button);
      section.append(heading, text);
      body.append(section);
    } else body.append(renderContent([block], dynamicsContext));
  }
  paintAnnotations(body, song, current());
  return {title, body, disposeChart: () => disposeDock()};
}
