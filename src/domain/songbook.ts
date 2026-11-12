/** App grouping is independent of a song's file/provider identity. */
export interface Songbook {id: string; name: string; folderId?: string; folderName?: string; folderMissing?: boolean}
export const standardSongbook: Readonly<Songbook> = {id: 'standard', name: 'Standard'};
