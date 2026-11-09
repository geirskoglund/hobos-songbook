# Hobo's Songbook

Offline-first sangbok som PWA for nettbrett, mobil og PC/Mac.

Appen har lokal innlesing av UTF-8 ChordPro/TXT, en enkel sangoversikt og sangvisning med akkorder, kommentarer og individuelle refrenghenvisninger, en kompakt sticky skjemavisning og en smal, sammenhengende dynamikkprofil med fem nivåer. Skjemaet bruker personlig innhold når det finnes, ellers felles grid fra filen. Innstillinger og appinformasjon åpnes fra menyen i toppen. Sanger lagres i IndexedDB med stabil intern ID og uendret originaltekst. Ved gjentatt filnavn spør innlesingen om en kopi skal importeres; bare filnavn med filendelse sammenlignes. Lys/mørk modus og skriftstørrelse (16–36 px) huskes per miljø. Appen fungerer uten konto og kan lese lagrede sanger offline etter at appressursene er cachet.

Når brukeren tar i bruk en ny appversjon, gjenopprettes aktiv skjerm, lesested og åpen innstillingsmeny i samme fane. Vanlig åpning av en sang starter fortsatt øverst.

«Rediger» fra sangmeny eller sangrad åpner sangen med en kompakt verktøylinje. Direkte gulmarkering, lokale notater, capo/stemming og personlig akkordskjema redigeres som utkast. «Lagre» lagrer uten å avslutte; tilbake gir valg om lagring eller forkasting ved endringer. Verktøylinjen står fast i full bredde med lagring til venstre. Markeringspennen velger tekst over flere linjer med egne håndtak og slår seg av etter hvert utvalg; notater kan flyttes med langt trykk og dra uten linjeramme. Appen håndterer tekst-/kontekstvalg på alle skjermer, også i skrivefeltene. Avbryt og OK er samlet nederst til høyre. Popupenes OK bekrefter et utkast og Avbryt forkaster det; bare Lagre skriver til lokal lagring. Skjema skrives fritt med taktstreker i en bred boks uten rammetagger, alltid for valgt capo. Takter vises kompakt; punktum gir eksplisitte tomme celler vist som luft. Capo omregner både tekstakkorder og skjema. Uten capo vises bare som pille under redigering. Takt hentes fra `{time: ...}`, med 4/4 som standard, og vises mellom toneart og capo.

[Eksempelfil med akkordskjema og dynamikk](examples/akkordskjema-og-dynamikk.cho) kan lastes ned og leses inn fra filvelgeren.

«Rediger sangtekst» i redigeringsvisningen åpner en fullskjermsmodal med eget tittelfelt, valgfrie toneart-/taktpiller og sammenhengende enkel sangtekst med egen scroll. «Ny sang» fra appmenyen åpner tomt utkast direkte. Tittel kreves, men teksten kan være tom. Første Avbryt avbryter opprettelsen; OK bekrefter bare utkastet. Først Lagre under modalvinduet oppretter eller endrer sangen vedvarende, sammen med eventuelle personendringer. Feil beholder utkastet. Manglende takt viser 4/4 uten nytt direktiv; første toneart flytter ingen akkorder. Endring av angitt toneart venter på transponering.

Musikalske/ukjente strukturer er foreløpig beskyttet mot tekstendring. Notater har faste logiske linjeposisjoner og forblir tilgjengelige ved tekstendringer, også i en tom sang. Gulmarkeringer justeres ved sikre tekstendringer og fjernes ved usikkerhet. Annoteringer lagrer ingen kopi av originalteksten. Originalendringer som kan ødelegge refrengvalg sperres fortsatt med forklaring. Uendret åpning/lagring bevarer eksakt original; trygg personlig redigering fungerer fortsatt. Musikalske verktøy, full råtekst/felles økthistorikk, transponering og eksport følger i #15–#21. Fullverdig bibliotek/kildefilter, konvertering, setlister og Dropbox er vedtatte fremtidskrav. Lokal lagring er ikke en sikkerhetskopi.

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

`npm run check` kjører TypeScript-kontroll, kontrakttester og Playwright mot reelle appbygg på samme origin. `Validate / validate` kjører på PR-hode og master. CI lagrer ferdige miljøbygg etter én full validering. Publisering henter riktig bygg og gjenbruker uendrede miljøer uten nye tester eller bygg. Eldre kilder uten gjenbrukbart bygg har en kontrollert reserveflyt. Godkjent master-merge publiserer produksjon og beholder valgt testcommit. Brukeren tester på fast adresse og godkjenner uttrykkelig før merge.
