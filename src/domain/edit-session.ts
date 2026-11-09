import type {Song, SongPersonal} from './song.ts';
import {personalChanges} from './personal.ts';
import {reconcilePersonal} from './annotations.ts';

export interface DraftSnapshot {song: Song; personal: SongPersonal}
/** One confirmed draft, one saved baseline. Views observe; dialogs commit only on OK. */
export function createEditSession(initial: Song, personal: SongPersonal, saved: Song | null = initial) {
  let song = initial, state = structuredClone(personal), baselineSong = saved, baselinePersonal = structuredClone(personal);
  const pendingChange = () => personalChanges(baselineSong ? reconcilePersonal(baselineSong, song, baselinePersonal) : baselinePersonal, state);
  return {
    get song() {return song;}, get personal() {return state;}, get baselineSong() {return baselineSong;},
    originalDirty: () => !baselineSong || baselineSong.original !== song.original,
    dirty: () => !baselineSong || baselineSong.original !== song.original || Boolean(pendingChange()),
    update(change: (current: SongPersonal) => SongPersonal) {state = change(state);},
    replaceOriginal(next: Song) {state = reconcilePersonal(song, next, state);song = next;},
    snapshot: (): DraftSnapshot => ({song, personal:structuredClone(state)}),
    pendingChange,
    markSaved(snapshot: DraftSnapshot) {baselineSong = snapshot.song;baselinePersonal = snapshot.personal;},
  };
}
export type EditSession = ReturnType<typeof createEditSession>;
