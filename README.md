# Hobo's Songbook

Offline-first sangbok som PWA for nettbrett, mobil og PC/Mac.

Appen har lokal innlesing av UTF-8 ChordPro/TXT, en enkel sangoversikt og sangvisning med akkorder, kommentarer og individuelle refrenghenvisninger, en kompakt sticky skjemavisning og en smal, sammenhengende dynamikkprofil med fem nivåer. Skjemaet bruker personlig innhold når det finnes, ellers felles grid fra filen. Innstillinger og appinformasjon åpnes fra menyen i toppen. Sanger lagres i IndexedDB med stabil intern ID og uendret originaltekst. Lys/mørk modus og skriftstørrelse (16–36 px) huskes per miljø. Appen fungerer uten konto og kan lese lagrede sanger offline etter at appressursene er cachet.

Når brukeren tar i bruk en ny appversjon, gjenopprettes aktiv skjerm, lesested og åpen innstillingsmeny i samme fane. Vanlig åpning av en sang starter fortsatt øverst.

«Rediger» fra sangmeny eller sangrad åpner sangen med en kompakt verktøylinje. Direkte gulmarkering, lokale notater, capo/stemming og personlig akkordskjema redigeres som utkast. «Lagre» lagrer uten å avslutte; tilbake gir valg om lagring eller forkasting ved endringer. Skjema skrives fritt i en liten boks med skjulte ChordPro-tagger og eksplisitt råvisning. Capo ved innskriving omregnes til faktiske akkorder ved lagring. Capo 0 vises bare under redigering.

[Eksempelfil med akkordskjema og dynamikk](examples/akkordskjema-og-dynamikk.cho) kan lastes ned og leses inn fra filvelgeren.

Fullverdig bibliotek/kildefilter, redigering av originaltekst/konvertering, setlister og Dropbox er vedtatte fremtidskrav. Lokal lagring er ikke en sikkerhetskopi.

- [Agentinstruksjoner](AGENTS.md)
- [Gjeldende produktkrav](docs/REQUIREMENTS.md)
- [Beslutninger og begrunnelser](docs/DECISIONS.md)
- [Arkitektur og miljøgrenser](docs/ARCHITECTURE.md)
- [Designprinsipper og åpne utformingsoppgaver](docs/DESIGN.md)
- [Kontroll, publisering og oppsett](docs/TESTING.md)
- Produksjonsadresse: https://geirskoglund.github.io/hobos-songbook/app/
- Testadresse: https://geirskoglund.github.io/hobos-songbook/test/

Produksjon følger godkjent master, mens valgt implementerings-PR prøves på testadressen. Publisert PR/SHA kontrolleres i appens meny og `build-info.json`. Grønn CI betyr ikke produktgodkjenning.

Bruk Node.js 24 LTS:

```sh
npm ci
npx playwright install chromium
npm run check
npm run build
npm run dev
```

Utviklingsadressen er `http://localhost:5173/hobos-songbook/test/`. Standard lokalt bygg er test fra gjeldende Git-HEAD; PR er tom (vist som master/kildegrunnlag). Utviklingsserveren leverer ikke et installasjons-/offlinebevis; bruk produksjonsbygg og nettlesertestene. Der en system-Chromium allerede finnes, kan `CHROMIUM_PATH` brukes i stedet for nedlasting. Se TESTING for eksplisitte miljøbygg.

`npm run check` kjører TypeScript-kontroll, kontrakttester og Playwright mot reelle appbygg på samme origin. `Validate / validate` kjører på PR-hode og master. Deploy venter på riktig grønn kildevalidering. Godkjent master-merge publiserer produksjon og beholder valgt testcommit. Brukeren tester på fast adresse og godkjenner uttrykkelig før merge.
