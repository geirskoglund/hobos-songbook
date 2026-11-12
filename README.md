# Hobo's Songbook

Offline-first sangbok som PWA for nettbrett, mobil og PC/Mac.

Appen har lokal innlesing av UTF-8 ChordPro/TXT, en alfabetisk sangliste med husket sangbokfilter og sangvisning med akkorder, kommentarer og individuelle refrenghenvisninger, en kompakt sticky skjemavisning og en sammenhengende dynamikkprofil i en fast 30 px venstremarg ved sangteksten. Profilens rette venstrekant står fast mens høyrekanten bruker nivåbreddene 5/10/15/20/25 px. Margen vises bare med gyldige dynamikktagger, aktiv global visning og minst 320 px skjermbredde. Skjemaet bruker personlig innhold når det finnes, ellers felles grid fra filen. Pin-knappen slår sticky av/på; den dempede pinnen er fortsatt klikkbar og fester skjemaet igjen. Hovedmenyen i toppen åpner Sanger, Setlister, Synkronisering, Filer og Innstillinger. Setlister har lokal opprettelse, navneendring og bekreftet sletting; vellykket opprettelse åpner den nye setlisten direkte, og detaljsiden er foreløpig tom. Synkronisering har Dropbox-tilkobling, egne delinger og manuell oppdatering av eksterne lesekilder. Filer er foreløpig tom. Sanger lagres i IndexedDB med stabil intern ID og uendret originaltekst. Ved gjentatt filnavn spør innlesingen om en kopi skal importeres; bare filnavn med filendelse sammenlignes. Appen bruker fast mørkt Organisk-tema i v1. Skriftstørrelse (16–36 px) og visningsvalg huskes per miljø. Appen fungerer uten konto og kan lese lagrede sanger offline etter at appressursene er cachet.

Forsiden heter Sanger. Midtstilt i toppen velges Alle eller én sangbok. Hver sang tilhører én sangbok; eksisterende sanger og nye/importerte sanger ligger i Standard. Valget huskes på tvers av sider og omstart. Sangradene viser tittel, toneart, takt og personlig capo/grep og stemming ved avvik. Trykk på en rad åpner sangen. Pluss nederst til høyre tilbyr Opprett og Importer. Radmenyen tilbyr Publiser/Avpubliser og Bytt sangbok for egne sanger, og Last ned for alle. Sangbokvelgeren kan opprette en bok der et mål kreves. En dempet markør viser Privat, Publisert eller Importert. Standard kan ikke publiseres. Under Rediger finnes sanghandlingene i den eksisterende menyen i headeren. Ordinær sangvisning tilbyr bare Last ned; den har ingen publiseringshandling. Toneart, takt, capo og stemming beholder sin samlede plassering og rekkefølge.

Når brukeren tar i bruk en ny appversjon, gjenopprettes aktiv skjerm, lesested og åpen hovedmeny og Innstillinger-side i samme fane. Dette omfatter valgt setliste og oversiktens posisjon. Ulagret setlistenavn må lagres eller avbrytes før oppdatering. Vanlig åpning av en sang starter fortsatt øverst.

«Rediger» i sangens header aktiverer redigering på den samme sangflaten; «Visning» går tilbake med bevart lesested. Verktøylinjen har Filinnhold og Egentilpasning, ikon med tekst, og felles Angre/Gjør om/Fjern. Verktøy velges før plassering eller utvalg. Gyldige endringer autospares lokalt. Ett besøk i en liten verdikontroll er ett angresteg, og historikken beholdes gjennom fane-/modusbytte og Innstillinger-retur frem til sangen forlates. Lagringsfeil beholder arbeidet og gir nytt forsøk. Lokal autosparing gjør ikke uferdig arbeid tilgjengelig i Dropbox. Ferdig redigering blir klar for automatisk synk når Visning velges eller sangen forlates; Innstillinger-retur beholder redigeringsøkten. Et avbrudd midt i Rediger krever at redigeringen avsluttes etter gjenåpning før opplasting.

Filinnhold har tittel, toneart, fritekst for takt, felles akkordskjema, akkorder, refreng med justerbare linjegrenser, refrenghenvisninger, anvisninger, dynamikk og Råtekst. Toneart transponerer inline-akkorder, alle felles skjemaer og personlig skjema samlet. Første toneartsangivelse flytter ingen akkorder. Egentilpasning har capo, stemming, personlig skjema, notater og gulmarkering på hele ord. Akkorder og begge skjemakontrollene bruker grepene som vises med valgt capo; C ved capo 2 lagres som klingende D. Personlig skjema overstyrer felles skjema. Skjema scroller under redigering. Egne refrengblokker støtter dynamikk underveis; henvisninger gjentar ikke dynamikktaggene og følger nivået på sitt eget sted. Henvisninger er alltid sammenfoldet i Rediger, mens tidligere åpne henvisninger gjenopprettes i Visning. Kilden skrives ikke om ved modusbytte.

Long press velger ett element med outline. Notater og inline-akkorder kan deretter dras. Ved berøring vises en større akkord over fingeren, med tekst rundt innsettingspunktet. Fjern sletter bare det valgte elementet og er deaktivert uten valg. Et trykk utenfor eller et annet verktøy opphever valget. Notater følger F05 med luft, avrunding og dempet, vannrett forankring til tekstlinjen, også under flytting; de påvirker ikke sangtekstens linjebryting. Små verdikontroller er énlinjet, åpnes nær trykkstedet og kan lukkes også ved ugyldig inntasting. Siste gyldige autosparte verdi beholdes. Stemming oppdateres uten full nytegning av sangen.

Ved sangslutt tilbyr plasseringsverktøyene «Rett etter» og «Med luft». Luft gir én kompakt blanklinje og bevarer eksisterende luft. En {chorus}-tagg uten tidligere refrengblokk vises som «Refreng», uten forklaringstekst, og kan brukes over brukerens egen refrengtekst.

Råtekst åpner hele ChordPro-kilden i fullskjerm med egen scroll og Avbryt/Lagre. Ti taggknapper og en []-knapp setter inn ved markøren; [] plasserer markøren inni klammene. Mus-/touch-trykk beholder feltfokus og skriveposisjon; tastaturaktivering gir fokusretur. Tagginnsetting og skriving har felles lokal teksthistorikk. Først Lagre gjør råtekstutkastet varig. Opprett fra sanglistens plussmeny åpner Råtekst med {t: } og markøren i tittelen over aktiv sangredigering; første Lagre oppretter sangen og viser redigeringen under. Første Avbryt etterlater ingen post. Tittel kreves; sangtekst kan være tom.

[Eksempelfil med akkordskjema og dynamikk](examples/akkordskjema-og-dynamikk.cho) kan leses inn fra filvelgeren. Uendrede kildeområder, BOM, taggvarianter og linjeskift bevares. Notater beholdes ved faste logiske posisjoner, også ved tom tekst. Sikre gulmarkeringer justeres; usikre kan falle bort uten å markere feil ord. Annoteringer lagrer ingen originalkopi. Konvertering, setlisteinnhold og full ZIP-backup er fortsatt senere arbeid. Last ned eksporterer sangens originale filinnhold uten persondata. Lokal lagring er ikke en sikkerhetskopi.

Dropbox bruker to separate App folder-apper med OAuth/PKCE, uten backend eller App secret. Biblioteket lagres i Private/, Shared/<sangbok>/ og Import/, med private JSON-metadata og persondata per sang under .app/. Egne enheter synkroniserer automatisk ved åpning, forgrunn og nettretur. Eksterne kilder oppdateres bare manuelt, enkeltvis eller samlet. Import-sanger har bare Egentilpasning; råtekst, kildeverktøy og akkordflytting er skrivebeskyttet. Egne delingslenker kan hentes/opprettes og kopieres fra Synkronisering.

Revisjonsbetingede opplastinger bevarer konflikter til senere; ingen mobilmerge kreves. Bekreftet slettede Dropbox-filer beholdes som lokale reserver under Vis slettede sanger. Fjernet lesekilde beholder frakoblede kopier. Behold privat spør om sangbok og kan opprette en ny. Manuell kopiering gir selvstendige filer; appkopiering/prosjektvarianter er fase 2. Oppsett, testdekning og gjenstående kontroll med ekte Dropbox-kontoer står i [TESTING](docs/TESTING.md#dropbox-og-synkronisering-32).

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
