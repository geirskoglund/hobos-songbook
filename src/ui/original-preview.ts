import {parseChordPro, type Content} from '../domain/chordpro.ts';
import type {Song} from '../domain/song.ts';
import {renderContent, renderGrid, type DynamicsContext} from './song-content.ts';
import {attachSongSpacing} from './song-spacing.ts';

/** Render from the source, without reader overlays, capo or editing controls. */
export function originalPreview(song: Song) {
  const root = document.createElement('div');
  root.className = 'original-preview song-body';
  root.setAttribute('aria-label','Beskyttet sangtekst');
  const context: DynamicsContext = {level:3};
  function append(parent: HTMLElement, content: Content[]) {
    for (const item of content) parent.append(item.kind === 'grid' ? renderGrid(item) : renderContent([item],context));
  }
  for (const block of parseChordPro(song.original,song.title).blocks) {
    if (block.kind === 'chorus' || block.kind === 'reference') {
      const section = document.createElement('section'); section.className = 'chorus';
      const heading = document.createElement('h2'); heading.textContent = 'Refreng';
      const content = document.createElement('div'); content.className = 'chorus-text';
      if (block.content) append(content,block.content);
      else {const missing=document.createElement('p');missing.className='comment';missing.textContent='Ingen tidligere refrengtekst er definert.';content.append(missing);}
      section.append(heading,content);root.append(section);
    } else append(root,[block]);
  }
  // Dynamics are not editable here; a copied SVG would retain stale reader geometry.
  root.querySelectorAll('.dynamic-announce').forEach(node=>node.remove());
  return {element:root,dispose:attachSongSpacing(root)};
}
