# Hobo's Songbook

Offline-first sangbok som PWA for nettbrett, mobil og PC/Mac.

Appen har lokal innlesing av UTF-8 ChordPro/TXT, en alfabetisk sangliste med husket sangbokfilter og sangvisning med akkorder, kommentarer og individuelle refrenghenvisninger, en kompakt sticky skjemavisning og en sammenhengende dynamikkprofil i en fast 30 px venstremarg ved sangteksten. Profilens rette venstrekant står fast mens høyrekanten bruker nivåbreddene 5/10/15/20/25 px. Margen vises bare med gyldige dynamikktagger, aktiv global visning og minst 320 px skjermbredde. Skjemaet bruker personlig innhold når det finnes, ellers felles grid fra filen. Pin-knappen slår sticky av/på; den dempede pinnen er fortsatt klikkbar og fester skjemaet igjen. Hovedmenyen i toppen åpner Sanger, Setlister, Synkronisering, Sangbøker, Filer og Innstillinger. Setlister har lokal opprettelse, navneendring og bekreftet sletting; vellykket opprettelse åpner den nye setlisten direkte, og detaljsiden er foreløpig tom. Synkronisering og Filer har tomt innhold. Sanger lagres i IndexedDB med stabil intern ID og uendret originaltekst. Ved gjentatt filnavn spør innlesingen om en kopi skal importeres; bare filnavn med filendelse sammenlignes. Appen bruker fast mørkt Organisk-tema i v1. Skriftstørrelse (16–36 px) og visningsvalg huskes per miljø. Appen fungerer uten konto og kan lese lagrede sanger offline etter at appressursene er cachet.

Forsiden heter Sanger. Midtstilt i toppen velges Alle eller én sangbok. Hver sang tilhører nøyaktig én sangbok. Standard opprettes ved førstegangsoppsett/migrering og er deretter en ordinær sangbok som kan endre navn eller slettes. Valget huskes på tvers av sider og omstart. Sangradene viser tittel, toneart, takt og personlig capo/grep og stemming ved avvik. Trykk på en rad åpner sangen. Pluss nederst til høyre tilbyr Opprett og Importer. Sangbøker har alfabetisk oversikt med sangantall, opprettelse, navneendring og bekreftet sletting. Sanger fra en slettet bok overføres samlet til en valgt eller ny bok; siste bok kan ikke slettes. Radtrykk åpner Sanger med bokfilteret. Dropbox-tilknytning kommer senere.

Når brukeren tar i bruk en ny appversjon, gjenopprettes aktiv skjerm, lesested og åpen hovedmeny og Innstillinger-side i samme fane. Dette omfatter valgt setliste og posisjonen i setliste- og sangbokoversiktene. Ulagret setliste-/sangboknavn må lagres eller avbrytes før oppdatering. Vanlig åpning av en sang starter fortsatt øverst.

«Rediger» i sangens header aktiverer redigering på den samme sangflaten; «Visning» går tilbake med bevart lesested. Verktøylinjen har Filinnhold og Egentilpasning, ikon med tekst, og felles Angre/Gjør om/Fjern. Verktøy velges før plassering eller utvalg. Gyldige endringer autospares lokalt. Ett besøk i en liten verdikontroll er ett angresteg, og historikken beholdes gjennom fane-/modusbytte og Innstillinger-retur frem til sangen forlates. Lagringsfeil beholder arbeidet og gir nytt forsøk. Lokal lagring publiserer ingen ekstern fil.

Filinnhold har tittel, toneart, fritekst for takt, felles akkordskjema, akkorder, refreng med justerbare linjegrenser, refrenghenvisninger, anvisninger, dynamikk og Råtekst. Toneart transponerer inline-akkorder, alle felles skjemaer og personlig skjema samlet. Første toneartsangivelse flytter ingen akkorder. Egentilpasning har capo, stemming, personlig skjema, notater og gulmarkering på hele ord. Akkorder og begge skjemakontrollene bruker grepene som vises med valgt capo; C ved capo 2 lagres som klingende D. Personlig skjema overstyrer felles skjema. Skjema scroller under redigering. Egne refrengblokker støtter dynamikk underveis; henvisninger gjentar ikke dynamikktaggene og følger nivået på sitt eget sted. Henvisninger er alltid sammenfoldet i Rediger, mens tidligere åpne henvisninger gjenopprettes i Visning. Kilden skrives ikke om ved modusbytte.

Long press velger ett element med outline. Notater og inline-akkorder kan deretter dras. Ved berøring vises en større akkord over fingeren, med tekst rundt innsettingspunktet. Fjern sletter bare det valgte elementet og er deaktivert uten valg. Et trykk utenfor eller et annet verktøy opphever valget. Notater følger F05 med luft, avrunding og dempet, vannrett forankring til tekstlinjen, også under flytting; de påvirker ikke sangtekstens linjebryting. Små verdikontroller er énlinjet, åpnes nær trykkstedet og kan lukkes også ved ugyldig inntasting. Siste gyldige autosparte verdi beholdes. Stemming oppdateres uten full nytegning av sangen.

Ved sangslutt tilbyr plasseringsverktøyene «Rett etter» og «Med luft». Luft gir én kompakt blanklinje og bevarer eksisterende luft. En {chorus}-tagg uten tidligere refrengblokk vises som «Refreng», uten forklaringstekst, og kan brukes over brukerens egen refrengtekst.

Råtekst åpner hele ChordPro-kilden i fullskjerm med egen scroll og Avbryt/Lagre. Ti taggknapper og en []-knapp setter inn ved markøren; [] plasserer markøren inni klammene. Mus-/touch-trykk beholder feltfokus og skriveposisjon; tastaturaktivering gir fokusretur. Tagginnsetting og skriving har felles lokal teksthistorikk. Først Lagre gjør råtekstutkastet varig. Opprett og Importer starter med én popup, Opprett i sangbok eller Importer i sangbok, med obligatorisk bokvalg og Avbryt/Fortsett. Valglisten utvides i samme popup. Én bok foreslås automatisk; ved flere brukes sist vellykket brukte bok i appøkten, deretter aktivt bokfilter, ellers intet valg. D10 tilbyr også Ny sangbok; en uttrykkelig lagret bok beholdes selv om den videre flyten avbrytes. Etter Fortsett åpner Opprett Råtekst med {t: } og markøren i tittelen over aktiv sangredigering; første Lagre oppretter sangen og viser redigeringen under. Første Avbryt etterlater ingen post. Tittel kreves; sangtekst kan være tom.

[Eksempelfil med akkordskjema og dynamikk](examples/akkordskjema-og-dynamikk.cho) kan leses inn fra filvelgeren. Uendrede kildeområder, BOM, taggvarianter og linjeskift bevares. Notater beholdes ved faste logiske posisjoner, også ved tom tekst. Sikre gulmarkeringer justeres; usikre kan falle bort uten å markere feil ord. Annoteringer lagrer ingen originalkopi. Eksport, eksterne kilder, konvertering, setlisteinnhold og Dropbox er fortsatt senere arbeid. Lokal lagring er ikke en sikkerhetskopi.

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
