export interface Setlist {
  id: string;
  name: string;
  createdAt: number;
  songIds: string[];
}

export function setlistName(value: string) {
  const name = value.trim();
  if (!name) throw new Error('Skriv inn et navn på setlisten.');
  return name;
}
