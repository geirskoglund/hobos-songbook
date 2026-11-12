import type { Song, SongPersonal } from './song.ts';
import { personalChanges } from './personal.ts';
import { reconcilePersonal } from './annotations.ts';
export interface DraftSnapshot {
  song: Song;
  personal: SongPersonal;
}
/** Song lifetime, independently of mode, render and storage completion. */
export function createEditSession(initial: Song, personal: SongPersonal, saved: Song | null = initial) {
  let song = initial,
    state = structuredClone(personal),
    baselineSong = saved,
    baselinePersonal = structuredClone(personal);
  const undo: {
      before: DraftSnapshot;
      after: DraftSnapshot;
    }[] = [],
    redo: typeof undo = [];
  let group: DraftSnapshot | undefined,
    groupEntry: (typeof undo)[number] | undefined,
    groupRedo: typeof redo = [];
  const snapshot = (): DraftSnapshot => ({
    song: structuredClone(song),
    personal: structuredClone(state)
  });
  const equal = (a: DraftSnapshot, b: DraftSnapshot) => a.song.original === b.song.original && !personalChanges({
    ...a.personal,
    chorus: b.personal.chorus
  }, b.personal) && !personalChanges({
    ...b.personal,
    chorus: a.personal.chorus
  }, a.personal);
  function record(before: DraftSnapshot) {
    const after = snapshot();
    if (equal(before, after)) return;
    redo.length = 0;
    if (group) {
      if (!groupEntry) {
        groupEntry = {
          before: group,
          after
        };
        undo.push(groupEntry);
      } else groupEntry.after = after;
    } else undo.push({
      before,
      after
    });
  }
  function restore(target: DraftSnapshot) {
    const chorus = reconcilePersonal(song, target.song, {
      ...state,
      annotations: undefined
    }).chorus;
    song = structuredClone(target.song);
    state = {
      ...structuredClone(target.personal),
      chorus
    };
  }
  const pendingChange = () => personalChanges(baselineSong ? reconcilePersonal(baselineSong, song, baselinePersonal) : baselinePersonal, state);
  return {
    get song() {
      return song;
    },
    get personal() {
      return state;
    },
    get baselineSong() {
      return baselineSong;
    },
    originalDirty: () => !baselineSong || baselineSong.original !== song.original,
    dirty: () => !baselineSong || baselineSong.original !== song.original || Boolean(pendingChange()),
    update(change: (current: SongPersonal) => SongPersonal) {
      const before = snapshot();
      state = change(state);
      record(before);
    },
    updateView(chorus: SongPersonal['chorus']) {
      state = {
        ...state,
        chorus
      };
      baselinePersonal = {
        ...baselinePersonal,
        chorus: baselineSong ? reconcilePersonal(song, baselineSong, {
          ...state,
          annotations: undefined
        }).chorus : chorus
      };
    },
    replaceOriginal(next: Song, change?: (current: SongPersonal) => SongPersonal) {
      const before = snapshot();
      state = reconcilePersonal(song, next, state);
      if (change) state = change(state);
      song = next;
      record(before);
    },
    beginGroup() {
      if (!group) {
        group = snapshot();
        groupEntry = undefined;
        groupRedo = [...redo];
      }
    },
    cancelGroup() {
      if (group) {
        restore(group);
        if (groupEntry) undo.splice(undo.indexOf(groupEntry), 1);
        redo.splice(0, redo.length, ...groupRedo);
        group = undefined;
        groupEntry = undefined;
      }
    },
    endGroup() {
      if (groupEntry && equal(groupEntry.before, groupEntry.after)) undo.splice(undo.indexOf(groupEntry), 1);
      group = undefined;
      groupEntry = undefined;
    },
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    undo() {
      if (group) return false;
      const entry = undo.pop();
      if (!entry) return false;
      restore(entry.before);
      redo.push(entry);
      return true;
    },
    redo() {
      if (group) return false;
      const entry = redo.pop();
      if (!entry) return false;
      restore(entry.after);
      undo.push(entry);
      return true;
    },
    snapshot,
    pendingChange,
    markSaved(snapshot: DraftSnapshot) {
      baselineSong = snapshot.song;
      baselinePersonal = snapshot.personal;
    }
  };
}
export type EditSession = ReturnType<typeof createEditSession>;
