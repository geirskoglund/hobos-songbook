# Arkitektur

## Implementert app og sanggrunnlag

Statisk HTML/CSS/TypeScript bygges med Vite. Ingen backend, skydatabase, autentisering, Dropbox-SDK eller CDN-ressurs brukes ved kjøring. Avhengighetsfilen låser verktøyene. De lokale PNG-ikonene har separate produksjons-/testvarianter; testbildet har «TEST». `scripts/generate-icons.mjs` gjenskaper dem uten nettavhengighet.

| Del | Ansvar nå | Grense mot senere arbeid |
| --- | --- | --- |
| `index.html`, `src/main.ts`, `src/app-updates.ts`, `src/style.css`, `src/ui/` | Sanginnlesing, enkel oversikt, fremføring/personlig redigering, miljømerking og workerstatus | Fullverdig bibliotek, originaleditor/konvertering og setlister kommer senere |
| `src/domain/{song,chordpro,grid,song-grid,personal}.ts` | Sangmodell, UTF-8-validering, avledet ChordPro-tolkning, capo og personlige utkast/ankere | Ingen DOM- eller leverandøravhengighet |
| `src/environment.ts` | Én validert miljøkonfigurasjon | ID-er/scopes/navn følger miljø; SHA/PR er bare byggmetadata |
| `src/storage/{songs,preferences,local-settings}.ts` | IndexedDB-sanger/personlige tilpasninger og miljøavgrensede visningsvalg | Ingen ekstern lagring; fremtidige skjemaversjoner oppgraderes additivt |
| `vite.config.mjs` | Miljøstier, manifest, lokale ikoner, `build-info.json` og Workbox-worker | Bygget er selvstendig under miljøets sti |
| `scripts/{pages-plan,github-pages,build-channel,assemble-pages,verify-pages}.mjs` | Betrodd CI/CD-kontrakt | PR-bygg kjøres ikke med deploymentrettigheter |
| `tests/*.test.mjs`, `tests/e2e` | Kilde-/miljø-/publiseringskontrakter og ekte nettleser/offline | Sanglagring/visning/offline testes; fysisk plattformtest rapporteres separat |

Nye domenemoduler kan legges under `src/domain/`, lokal vedvarende lagring under `src/storage/` og leverandørtilkobling under `src/adapters/`. Disse grensene er arkitekturretning, ikke et forhåndsimplementert pluginrammeverk eller tomme krav om en omfattende lagdeling. Domenet skal ikke importere Dropbox-API/-SDK.

## Miljøidentitet og data

| Egenskap | Produksjon | Test |
| --- | --- | --- |
| Pages-sti, worker-scope | `/hobos-songbook/app/` | `/hobos-songbook/test/` |
| Appnavn/short_name | Hobo's Songbook | Hobo's Songbook Test |
| Stabil namespace/cache-ID | `hobos-songbook-production` | `hobos-songbook-test` |
| IndexedDB-navn | `hobos-songbook-production` | `hobos-songbook-test` |
| localStorage-prefiks | `hobos-songbook-production:` | `hobos-songbook-test:` |
| Manifest `id/start_url/scope` | `./`, løst til app-stien | `./`, løst til test-stien |

IndexedDB har eksplisitt skjemaversjon 1 med `songs` (keyPath `id`) og `personal` (keyPath `songId`). Hver innlesing oppretter UUID, også for samme fil/tittel. En sang inneholder `id`, autoritativ `original`, avledet `title`/`key` og `origin` med `kind`, `filename`, `importedAt` samt plass til `provider`, `sourceId`, `fileId`, `relativePath`. Originalen beholder BOM, linjeskift og ukjente direktiver. Parseren arbeider med en separat representasjon, som ikke skrives tilbake.

`personal` inneholder `songId`, formatversjon 2, capo, stemming, annoteringer, eventuelt `chordGrid` som separat klingende ChordPro-tekst for personlig skjema og et kart `chorus` fra deterministisk originallinjereferanse (`line:N`, nullbasert) til boolsk tilstand. Det er separat fra originalinnholdet. Utkast, transaksjonell lagring og ankere er beskrevet under «Personlige tilpasninger». Gjenforankring ved endret originaltekst gjenstår. localStorage-nøkkelen `<namespace>:display` inneholder globalt `theme`, `fontSize`, `showGrids` og `showDynamics`. Eksisterende innstillinger uten de nye feltene beholder tema/størrelse og får begge visningene på. Appens oppstart bruker miljøets innstillinger før innholdet vises. Ingen lagringsnavn følger SHA/PR.

Databaseoperasjoner lukker forbindelsen etter fullført transaksjon. Innlesing regnes først som lagret ved `oncomplete`; `add` kan ikke overskrive en eksisterende sang. Blokkert/avvist åpning, abort og innstillingsfeil vises uten nullstilling. Ingen database-/brukerdatasletting skjer ved appstart eller oppdatering. Testharness bruker egne `-harness`-databaser; workeroppdatering prøves også med faktiske sanger og personlige valg.

Begge miljøer og andre Pages-prosjekter deler `geirskoglund.github.io`-origin. Navn/scopes hindrer utilsiktet kollisjon; script på samme origin er ikke sikkerhetsisolert fra andre miljøer. Nettleserprofil, privatmodus og en ny hjemskjerminstallasjon kan ha annen lagring. Ingen automatisk kopiering mellom test og prod.

## Offline og oppdatering

`vite-plugin-pwa`/Workbox genererer hver sin `sw.js` med lokale JS/CSS/HTML/ikoner/manifest/byggmetadata i precache. Fallback gjelder navigasjon bare under eget miljø. Ingen root-worker for `/hobos-songbook/`, ingen runtime-cache av Dropbox eller eksterne tjenester. Workbox rydder foreldede ressurser i egen precache ved aktivering; bred `cleanupOutdatedCaches` er av.

Et første nettbesøk må fullføre caching/worker-oppsett før offline loves. Startsiden viser når skallet er klart. Manglende workerstøtte eller registreringsfeil gir ingen falsk offline-klar status. Cache-/nettleserdata kan fortsatt slettes/evikteres av plattformen; de er ikke backup.

`src/app-updates.ts` registrerer den genererte workeren med nettleserens service-worker-API og `updateViaCache: none`. Kontroller skjer ved oppstart, når appen får fokus/blir synlig, ved nettilbakekomst og hvert minutt mens den er synlig og på nett. «Se etter oppdatering» kan også brukes manuelt. En ferdig nedlastet, ventende worker med bekreftet annen byggidentitet gir et fast, tilgjengelig varsel med «Oppdater nå», også mens brukeren leser langt nede i en sang eller har lukket appinformasjonen.

`src/worker-build.ts` spør den aktuelle workeren via `MessageChannel` om dens innbakte byggmetadata. Vite genererer en liten `worker-build-<hash>.js` med miljøets eksakte metadata; den importeres av workeren og caches offline. Filnavnet følger metadataene slik at gammel HTTP-cache ikke kan gi en ny worker feil versjon. Varsel krever forskjell i SHA/PR i samme miljø, ikke bare `waiting`/`controllerchange`. En fersk side med eldre controller, overtakelse fra en worker med samme bygg og repakking av samme versjon gir ikke ny-versjon-varsel. Manglende eller ugyldig svar gir ingen påstand om ny/siste versjon. Eksisterende controller ved sidestart behandles ikke som en ny utgave.

Aktivering krever et eksplisitt trykk. Appen sender `SKIP_WAITING` til den ventende workeren og laster siden på nytt når akkurat denne workeren overtar kontrollen. Dette gjelder også oppdatering i første appøkt uten tidligere omlasting. Dersom en annen fane i samme miljø aktiverer den, får den eksisterende siden tilbud om omlasting og fortsetter å vise sitt innhold inntil brukeren velger. Manglende aktivering gir en tidsavgrenset feil med mulighet for nytt forsøk. Sanger/innstillinger slettes ikke, og søskenmiljøet navigeres ikke. Oppdateringsstyrt omlasting avventer pågående personlig lagring. Ulagret arbeid eller lagringsfeil beholder editoren og stopper omlasting.

Alle oppdateringsstyrte omlastinger bruker samme callback fra appvisningen. `src/ui/update-view.ts` lagrer et engangsøyeblikksbilde under miljøets nøkkel i den aktuelle historioppføringen med `history.replaceState`, uten å legge til en tilbake-oppføring. Det omfatter valgt sang-ID eller oversikt, lesested, frigjort sticky-skjema, menyens åpne/lukkede tilstand, meny-scroll, appinformasjonsfelt og fokus. Øyeblikksbildet er avgrenset til fanen og miljøet og kopierer ikke originaltekst. Ved oppstart forbrukes det én gang. Etter at data og layout er klare, gjenopprettes synlig innholdsrad med relativ plassering, slik at ny ombrekking ikke flytter brukeren til en annen del av teksten. Manglende rad bruker lagret scrollposisjon; manglende sang gir oversikten. Ugyldig eller utilgjengelig historikk hindrer ikke appoppdatering. Vanlig ny åpning eller bevisst sideomlasting uten oppdateringsøyeblikksbilde følger ordinær startflyt.

## Publisering

Bare `pages.yml` fra standardbranch styrer Pages. Plan og deploy kjører eksakt validert master-infrastruktur, mens CI validerer hver kildecommit én gang og lagrer ferdige, pinnede miljøbygg. Lesende klargjøringsjobber henter bare data fra riktig valideringskjøring eller gjenbruker uendret publisert kanal. Tokanal-artifacts valideres som data før ett nettsted settes sammen. `build-files.json` i hver kanal lister alle filer med størrelse og SHA-256. Bare en manglende inventarfil (eldre publisering) tillater reserveflyt; korrupt innhold stopper. Eldre kilder uten tilgjengelig CI-artifact eller publisert inventar kan bygges og valideres én gang i en jobb uten deployrettigheter. Rootens `deployment.json` bevarer kilder/testvalg; `build-info.json` identifiserer hvert appbygg.

Ingen direkte push-deploy kan vinne over master-CI. Riktig workflow-ID/-sti, repo/kilderepo, hendelse, SHA og vellykket valideringsjobb kreves. For bevart test etter lukket PR kan GitHub fjerne PR-lenken fra Actions-resultatet; da gjenfinnes kildebindingen fra GitHubs commit/PR-assosiasjon for den lukkede samme-repo-PR-en. Dette gir ingen tillatelse til å velge en ny lukket PR til test.

Produksjon bruker bare master; test beholder valgt eksakt commit også etter merge/branchsletting. Før appskallet finnes på master kan produksjon være en betrodd oppstartsplassholder, mens PR-appen bare publiseres til test. [TESTING](TESTING.md) beskriver valg, minste rettigheter, feil, første oppsett og HTTPS-kontroll.

## Videre domene og lokal lagring

Intern sangidentitet, originaltekst, opprinnelse og personlige tilpasninger finnes nå. Private arbeidskopier, setlister og tokenlagring får egne versjonerte utvidelser ved senere funksjonsimplementering.

- Kildesang, privat arbeidskopi og personlig lag er ulike ansvar. Synk overskriver ikke upublisert arbeid. Usikre annoteringer beholder gammel linje-/tekst-/kontekstinformasjon til brukerens avgjørelse.
- Intern setliste er referanser; selvforsynt `.setlist` inkluderer tekst som transport/reserve. Oppdatert bibliotek er autoritativt, med forskjellige regler for førstegangsimport og senere manglende kilde. Se REQUIREMENTS §6.
- Ekstern fil-ID/kilde/relativ sti er adapterinformasjon. Intern sang-ID skrives ikke inn i eksisterende ChordPro-filer. Leverandørbytte/gjenkobling trenger matching/migrering, ikke ny domenemodell.
- ZIP-backup bevarer kilde-/undermapper og separate sangfiler sammen med versjonert samlet JSON og personlige data. Identifikator-/manifestformat defineres senere, uten internt restore-/ID-remappingssystem.

## Senere ekstern lagring

Én avgrenset Dropbox-adapter skal håndtere OAuth/PKCE, lesende delte kilder, les-/skrivbar privat App folder og eksplisitt manuell synk. Den sentrale logikken og IndexedDB kjenner ikke Dropbox-SDK. Ingen generelt provider-/pluginrammeverk eller andre skyleverandører i v1. Kildepublisering skjer gjennom fileksport/OS, ikke ved å utnytte App folder-skriverett i eksterne mapper.

Bevarte konfigurasjonsbeslutninger fra originalen, **ikke aktive integrasjoner**:

- Dropbox-apper: `hobos.songbook.app` og `hobos.songbook.test.app`.
- Testens offentlige App key: `le5cddh388klcjz` (offentlig klient-ID, ikke App secret).
- Eksakte OAuth Redirect URI-er må registreres ved integrasjonsarbeidet; ingen App secret i frontend.
- App folder-scopes og krav til tilbakekalling/frakobling står i REQUIREMENTS §8. Rekursiv lesing, identitet mellom kontoer, negativ tilgangstest og sikker tokenhåndtering er fortsatt praktiske/tekniske arbeidsoppgaver.

## Avgrenset ChordPro-tolkning

Parseren støtter `title/t`, `key`, `comment/c`, `soc/eoc`, `start_of_chorus/end_of_chorus` og `chorus` som egne direktivlinjer. Refrenghenvisning bruker nærmeste tidligere definerte refrengblokk; uten tidligere definisjon vises en merknad. Første og øvrige eksplisitte refrengblokker er fullt synlige, mens henvisninger starter lukket. Uavsluttede blokker lukkes ved filslutt/neste blokk; feilplassert sluttmarkør sluker ingen tekst. Ukjente direktiver vises forsiktig som lesbar tekst. Ingen full ChordPro-standardstøtte eller eldreformatkonvertering loves.

Gjenkjennelige akkordsymboler beholdes i originale stavemåter; `[Solo]`, `[Fele]`, `[Ref]` forblir tekst. Visningen bygger trygge tekstnoder, og bruker inline-grid for akkord/tekst-par. Ord kan brytes mellom par; lange enkeltord kan brytes inne i tekstcellen uten å flytte akkorden fra starten. Flere påfølgende akkorder og rene akkordlinjer har egne celler.

## Felles akkordskjema og dynamikk (F31–F32)

`start_of_grid/end_of_grid` og `sog/eog` gir egne gridblokker på sin plass i sangen, også inne i refreng. Griden har avledede rader, marginmerknader og takter med slagceller. Taktstreker, repetisjon/volta, tomme celler (`.`), slag (`/`), gjentakelser (`%`/`%%`) og flere akkorder i samme celle (`C~G`) vises. Klangsymboler bruker samme konservative akkordgjenkjenning som sangtekst. `shape="4x4"`, tilsvarende eldre kolonform og `label` støttes; uten form følger layouten rader/takter fra teksten. [ChordPro-gridspesifikasjonen](https://www.chordpro.org/chordpro/directives-env_grid/) er formatreferanse. Strum-pseudokorder og øvrige ukjente utvidelser vises lesbart, uten automatisk konvertering eller transponering. Uavsluttede/nestede blokker mister ikke etterfølgende innhold.

Gyldig `x_dyn: 1`–`5` gir instruksjonsnoder i den avledede strukturen. Visningen starter på 3 og følger nivået til neste gyldige tagg. Ugyldige verdier gir merknad og beholder forrige nivå. Ved refrenghenvisning gjentas også instruksjonene som faktisk finnes i refrengblokken; uten ny tagg videreføres gjeldende nivå. Dette beregnes uavhengig av om henvisningen er foldet sammen.

`src/domain/song-grid.ts` velger ett innhold til den felles skjemavisningen: `personal.chordGrid` når det finnes, ellers alle originale gridblokker i kilderekkefølge (uten kopier fra refrenghenvisninger), ellers ingen. Personlig innhold er separat og brukes uendret som inngang til samme parser/renderer. Opprettelse/redigering skjer i den felles personlige editoren. Skjema lagres i klingende form og omregnes bare i avledet visning. Ugyldig utkast erstatter ikke gyldig lagring. Brukeren fjerner personlig skjema ved å tømme feltene, bekrefte med OK og lagre; da brukes felles skjema hvis det finnes, ellers intet skjema. Inline-grid utelates fra selve tekstflaten, men dynamikkinstruksjoner der beholder sin musikalske virkning i sangen.

`chart-dock.ts` gir samme kompakte flate for begge kilder, med sticky i fremføring og ordinær plassering under redigering. × endrer bare panelet fra sticky til ordinær plassering i dokumentet. Innhold og høyde beholdes, og fokus flyttes til tilbakeknappen uten scrolling. Tilstanden lagres ikke; neste åpning har sticky på igjen. ResizeObserver/vindusendring tilpasser høyden ved behov med samlet skalering, uten indre scroll. Observatører og hendelseslyttere fjernes ved bytte/lukking av sang.

`song-spacing.ts` samler avledede blanklinjemarkører til én kompakt pause på en halv tekstlinje før neste synlige innhold. CSS bruker 1,2 linjeavstand og samme mål i `--reader-line`, med tett akkordrekke. Uten blanklinje i kilden settes ingen ekstra avstand, også mellom kommentarer og refreng. Markørene opptar ingen egen høyde; skjulte refreng tas ikke med. Normaliseringen gjentas ved folding, og CSS-variabler følger skriftvalget uten å endre originaltekst eller parserdata.

`dynamics-profile.ts` tegner én lukket, symmetrisk SVG-sti over hele tekstområdets høyde. Fem bredder skaleres innenfor et smalt felt på høyst 112 px / 22 prosent av leseområdet. Nivåer kommer fortsatt fra de avledede instruksjonene (default 3); lokale Bézier-overganger runder skiftene uten automatisk crescendo. Synlige rader gir plassering; skjulte refreng endrer ikke det beregnede nivået etter henvisningen. ResizeObserver og observasjon av sammenfolding holder formen oppdatert. Dette er layoutgeometri, ikke en tidsakse.

Visningsvalg leses fra den eksisterende miljønøkkelen og gjelder både personlig/felles skjema. Ingen sang-/databaseskjemaoppgradering er nødvendig. En tilgjengelig menydialog samler innstillinger og appstatus. Oppdateringsmodulen finner de samme kontroll-ID-ene og fortsetter å vise reelle oppdateringsvarsler utenfor menyen.

## Personlige tilpasninger (issue #8)

`personal` utvides additivt med formatversjon 2, capo, stemming og annoteringer. Det eldre feltet `chordView` beholdes lesbart i lagringsmodellen, men styrer ikke lenger visningen; capo er felles regel for alle akkorder. IndexedDB forblir versjon 1; gamle poster nullstilles ikke. `updatePersonal` leser/endrer/skriver i én transaksjon. Editoren sammenligner arbeidskopien med sist lagrede øyeblikksbilde. Bare faktisk endrede felt/annoteringsfelt anvendes samlet på nyeste lagrede post ved «Lagre». Tilbakeførte verdier er ikke utestående skriv. Ved lagring under videre redigering flyttes sammenligningsgrunnlaget bare til det innsendte øyeblikksbildet. Dermed bevares uberørte felt fra andre faner, også refrengvalg. Ved samme felt gjelder sist fullførte lagring. Feil beholder hele utkastet. Forkasting skriver ingen av endringene.

Parserens tekstlinjer, tomme linjer og merknader har nullbasert `sourceLine`. Annoteringsnøkkel kombinerer denne med `source` eller refrenghenvisningens `line:N`. Ankeret bevarer sang-ID, forekomst, tekst, kildelinje, naboer og eksakt original. Spenn er halvåpne UTF-16-indekser uten akkorder/tilgjengelighetstekst. Appens utvalg over `.lyric`-noder omregnes til tekstspenn per logiske linje, også over flere linjer; ingen separat tekstkopi. Valgfrie `groupId` på spenn binder et samlet utvalg sammen på tvers av linjer uten å endre eldre poster. Sletting og endring av et samlet utvalg oppdaterer alle berørte ankere i én utkastendring. Ved annen original beholdes data uten gjettet plassering. Full gjenforankring er fremtidig arbeid.

`personal-editor.ts` gir fast ikonverktøylinje og lokale native dialoger med fokusfangst. `highlight-editor.ts` håndterer utvalg, tekstkoordinater, forhåndsmarkering og felles håndtak. Pennegesten bruker pekere og et eget overlegg uten å opprette native Selection; touch-action/user-select og contextmenu håndteres i markeringsmodus. PC-tekstvalg før verktøyvalg tegnes nå som et eget ventende utvalg; verktøyvalget bekrefter det. Callback etter ett bekreftet pennestrøk slår av pennemodusen, mens markeringshåndtakene beholdes. Ingen appkontroll settes inn i selve tekstspennet under utvalget. Popupenes arbeidskopi bekreftes kun med OK; Avbryt/Escape/fullført utvendig trykk forkaster. Pekerbevegelse, scroll og avbrutt berøring avvises som plasseringsklikk. Notatplassering utledes fra den aktuelle pekeren eller et levende tekstvalg, aldri lagret fokus. `note-drag.ts` løfter etter et stasjonært hold, viser flyttbart overlegg uten mållinjeramme, og endrer kilde-/målnotat atomisk i utkastet ved gyldig slipp. Tidlig touch-bevegelse scroller, og avbrudd endrer ikke anker. Kant-scroll deles med markeringsverktøyet.

Sangen beholder samme renderer; capo/skjemautkast oppdaterer avledet visning. `shiftGridText` omregner bare gjenkjente akkordceller og bevarer takter, marginer, direktiver og whitespace. Ved capo N flyttes inndata opp N halvtoner ved OK, og visning ned N. Skjemaeditoren viser bare innholdet mellom rammetaggene; endres ikke feltet, bevares eksakt eksisterende representasjon. Tomme blokker fjernes; helt tomt personlig skjema faller tilbake til felles. Ugyldig utkast erstatter ikke gyldig lagring.

Taktart parses avledet fra `{time: ...}`, med 4/4 ved fravær. Første gyldige angivelse vises i sangtoppen; senere taktartsskifter beholdes lesbart på sin plass i innholdet. Det lagres ikke et personlig eller duplisert taktartfelt, og originalteksten endres ikke.

Editorens inngangssted og opprinnelige leseøyeblikksbilde bruker eksisterende engangsbevaring. Appoppdatering avventer pågående lagring og stopper ved ulagrede endringer; den autosparer ikke. Etter lagring kan redigeringsmodus gjenopprettes ved brukerens oppdatering. Vanlig omlasting varsler om ulagret arbeid og bruker ellers ordinær startflyt.

Skjemarendereren bruker innholdsbredde per takt og viser bare oppgitte celler. Punktum blir en tom celle uten synlig prikk. Det reserveres ingen tom åpningskolonne for en takt som deler foregående taktstrek, og ingen global akkord-/taktbredde brukes til å strekke innholdet. ChordPro-shape bevares og begrenser takter per rad, uten uspesifiserte fylleceller.

`app-interactions.ts` etablerer én global policy før sangboken starter: contextmenu/selectstart/dragstart/invalid håndteres for hele dokumentet, og appkontroller bruker ikke title-attributter eller reportValidity. Skjemaets gyldighetsfeil er tilgjengelig appinnhold. Berøring i tekstfelt bruker fullførte pekerbevegelser, en midlertidig speiling for caret-posisjon og appens tekstmeny i aktuell dialog. Feltets scrolling, fokus, tastatur, utvalg og native angrehistorikk beholdes. Clipboard-read kalles bare ved allerede gitt tillatelse, med tastaturinnliming som fallback; ingen automatisk tillatelsesforespørsel. Native operativsystem-/nettleser-UI utenfor siden kan ikke garanteres blokkert.
