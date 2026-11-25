# Hobo's Songbook

> **Her står:** hva appen er, adressene, hvordan den startes, og hvor dokumentasjonen ligger.
>
> **Ikke her:** produktregler, arbeidsform eller testdetaljer.

Offline-first sangbok som PWA for nettbrett, mobil og PC/Mac. Appen leser ChordPro- og tekstfiler, viser sanger med akkorder, refreng, akkordskjema og dynamikk, og lar deg redigere sangene og legge på egne tilpasninger som capo, notater og markeringer. Sangene ligger lokalt og kan synkroniseres med din egen Dropbox. Appen virker uten konto og uten nett.

- Produksjon: https://geirskoglund.github.io/hobos-songbook/app/
- Test: https://geirskoglund.github.io/hobos-songbook/test/

Produksjon bygges fra `master`. Test viser en valgt PR, og har egen lagring og egen Dropbox-app.

## Kom i gang

Krever Node.js 24 LTS.

```sh
npm ci
npx playwright install chromium
npm run dev     # http://localhost:5173/hobos-songbook/test/
npm run check   # full validering, som i CI
```

[Eksempelfilen](examples/akkordskjema-og-dynamikk.cho) viser akkordskjema og dynamikk og kan leses inn fra filvelgeren.

## Dokumentasjon

- [Produktkrav](docs/REQUIREMENTS.md)
- [Beslutninger](docs/DECISIONS.md)
- [Arkitektur](docs/ARCHITECTURE.md)
- [Design](docs/DESIGN.md)
- [Test og publisering](docs/TESTING.md)
- [Ordliste](GLOSSARY.md)
- [Arbeidsform for Claude Code](CLAUDE.md)
