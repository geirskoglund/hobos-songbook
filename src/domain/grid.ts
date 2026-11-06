export interface GridMeasure {opening: string; closing: string; cells: string[]}
export interface GridRow {kind: 'grid-row'; left: string; measures: GridMeasure[]; right: string}
export interface GridOptions {columns: number | null; beats: number | null; label: string | null}

/** Space-separated beat cells, with shared bar lines and readable margin notes. */
export function parseGridRow(line: string): GridRow {
  const markers = [...line.matchAll(/:\|(?:\d+>?|:)?|\|(?:\||:|\.|\d+>?)?/g)];
  const row: GridRow = {kind: 'grid-row', left: '', measures: [], right: ''};
  if (!markers.length) {row.left = line; return row;}
  row.left = line.slice(0, markers[0].index).trim();
  for (let index = 0; index < markers.length - 1; index++) {
    const marker = markers[index], next = markers[index + 1];
    const text = line.slice(marker.index! + marker[0].length, next.index).trim();
    row.measures.push({opening: index === 0 ? marker[0] : '', closing: next[0], cells: text ? text.split(/\s+/) : []});
  }
  row.right = line.slice(markers.at(-1)!.index! + markers.at(-1)![0].length).trim();
  // A lone bar line is still visible; text after it stays a margin note.
  if (markers.length === 1) row.measures.push({opening: markers[0][0], closing: '', cells: []});
  return row;
}
export function gridOptions(value: string, previous?: GridOptions): GridOptions {
  const shape = value.match(/\bshape\s*=\s*["']?([0-9+x]+)/i)?.[1] ?? value.match(/^([0-9+x]+)(?:\s|$)/i)?.[1];
  const label = value.match(/\blabel\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const legacyLabel = shape ? value.replace(/^([0-9+x]+)\s*/i, '').trim() : value.trim();
  const center = shape?.split('+').length === 3 ? shape.split('+')[1] : shape?.includes('x') ? shape.match(/\d+x\d+/i)?.[0] : shape;
  const dimensions = center?.match(/^(\d+)x(\d+)$/i);
  const bounded = (number: string, max: number) => Number(number) >= 1 && Number(number) <= max ? Number(number) : null;
  return {
    columns: shape ? dimensions ? bounded(dimensions[1], 16) : null : previous?.columns ?? null,
    beats: shape ? dimensions ? bounded(dimensions[2], 32) : null : previous?.beats ?? null,
    label: label ? label[1] ?? label[2] : !/\b(?:shape|label)\s*=/i.test(legacyLabel) && legacyLabel ? legacyLabel : null,
  };
}
