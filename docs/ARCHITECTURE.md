# Arkitektur

## Implementert app og sanggrunnlag

Statisk HTML/CSS/TypeScript bygges med Vite. Ingen backend, skydatabase, autentisering, Dropbox-SDK eller CDN-ressurs brukes ved kjøring. Avhengighetsfilen låser verktøyene. De lokale PNG-ikonene har separate produksjons-/testvarianter; testbildet har «TEST». `scripts/generate-icons.mjs` gjenskaper dem uten nettavhengighet.

| Del | Ansvar nå | Grense mot senere arbeid |
| --- | --- | --- |
| `index.html`, `src/main.ts`, `src/app-updates.ts`, `src/style.css`, `src/ui/` | Sanginnlesing, enkel oversikt, fremføring/personlig redigering, miljømerking og workerstatus | Originalgrunnflate finnes; sangbokadministrasjon, musikalske originalverktøy/konvertering og setlisteinnhold kommer senere |
| `src/domain/{song,chordpro,grid,song-grid,personal,original,source-edit,edit-session}.ts` | Sangmodell, UTF-8-validering, avledet ChordPro-tolkning, capo og personlige utkast/ankere | Ingen DOM- eller leverandøravhengighet |
| `src/environment.ts` | Én validert miljøkonfigurasjon | ID-er/scopes/navn følger miljø; SHA/PR er bare byggmetadata |
| `src/storage/{songs,preferences,local-settings}.ts` | IndexedDB-sanger/personlige tilpasninger og miljøavgrensede visningsvalg | Ingen ekstern lagring; fremtidige skjemaversjoner oppgraderes additivt |
| `vite.config.mjs` | Miljøstier, manifest, lokale ikoner, `build-info.json` og Workbox-worker | Bygget er selvstendig under miljøets sti |
| `scripts/{pages-plan,github-pages,build-channel,assemble-pages,verify-pages}.mjs` | Betrodd CI/CD-kontrakt | PR-bygg kjøres ikke med deploymentrettigheter |
| `tests/*.test.mjs`, `tests/e2e` | Kilde-/miljø-/publiseringskontrakter og ekte nettleser/offline | Sanglagring/visning/offline testes; fysisk plattformtest rapporteres separat |

Nye domenemoduler kan legges under `src/domain/`, lokal vedvarende lagring under `src/storage/` og leverandørtilkobling under `src/adapters/`. Disse grensene er arkitekturretning, ikke et forhåndsimplementert pluginrammeverk eller tomme krav om en omfattende lagdeling. Domenet skal ikke importere Dropbox-API/-SDK.

## Felles UI og layout

Én implementasjon per kontrolltype brukes fra alle relevante brukssteder, med innhold, verdi, tilstand, varianter og callbacks som parametere. Mange instanser er tillatt; parallelle kopier er det ikke. Felleskomponenten eier form, tilgjengelighet og betjening; bruksstedet eier domenehandling og lagringsbetydning. Varianter bygges med komposisjon fremfor lokale rettelser.

`theme.css` eier designverdier, fontroller og overordnede bredder/sidekanter. `ui/layout.ts` eier aktiv hovedflate, viewportplassering og målt header-/verktøylinjehøyde. Sticky-skjema, fast verktøylinje, menypanel og kant-scroll bruker samme grunnlag. `ui/controls.ts` eier ikon-/handlingskontroller, tekstfelt, brytere, skyver, dialogramme og footervarianter; `ui/dialog.ts` eier åpning, fokus, avbrudd og rydding. `ui/list-controls.ts` og tilhørende CSS eier H01/H04, L01/L02/L05 og D09. L02 tar navn, antall, radhandling og separat menyhandling; H04 tar foretrukket plassering. `ui/setlists.ts` eier navneadministrasjon, bekreftelse og setlistekontekst. Avbryt-symbolet i E03 er tilgjengelig som felles `avbryt.svg`. Valgbare rader komponeres i sangbokvelgeren; meny/picker bruker felles dialoglivssyklus og viewportplassering. Headerens tre like kolonner holder filteret midtstilt også ved ulikt innhold på sidene. `ui/navigation.ts` har ett sidepanel under den operative headeren og beskytter resten av flaten mens det er åpent.

Visningstilstand kan hentes direkte for ordinær retur, uavhengig av historikkpersistens ved appoppdatering. Hovedsider er sangliste, sang, Innstillinger, setlisteoversikt, tom setlistedetalj og de tomme Synkronisering/Filer. Innstillingsbesøk kan bevare en underliggende sangøkt; faktisk øktbytte bruker utgangsvernet.

Inter, Gentium Book Plus og Cousine leveres med lokale WOFF2-filer/lisenser. Runtimeikoner bundles fra ett register; designreferanser under `docs/design` er ikke runtime. Fontfilene inngår i begge miljøers precache. V1 bruker fast mørkt tema; eldre lysvalg ignoreres uten nullstilling av øvrige innstillinger.

## Miljøidentitet og data

| Egenskap | Produksjon | Test |
| --- | --- | --- |
| Pages-sti, worker-scope | `/hobos-songbook/app/` | `/hobos-songbook/test/` |
| Appnavn/short_name | Hobo's Songbook | Hobo's Songbook Test |
| Stabil namespace/cache-ID | `hobos-songbook-production` | `hobos-songbook-test` |
| IndexedDB-navn | `hobos-songbook-production` | `hobos-songbook-test` |
| localStorage-prefiks | `hobos-songbook-production:` | `hobos-songbook-test:` |
| Manifest `id/start_url/scope` | `./`, løst til app-stien | `./`, løst til test-stien |

IndexedDB har skjemaversjon 3 med `songs` (keyPath `id`), `personal` (keyPath `songId`), `songbooks` (keyPath `id`) og `setlists` (keyPath `id`). Versjon 3 oppretter bare det nye setlistelageret; oppgradering fra både v1 og v2 bevarer alle eksisterende poster. Oppgraderingen fra versjon 1 oppretter `{id: standard, name: Standard}` og tilordner bare sanger uten sangbok til denne i samme versjonsoppgraderingstransaksjon. Abort ruller tilbake hele oppgraderingen; blokkert oppgradering viser feil og gir nytt forsøk. Ingen data slettes eller nullstilles. `domain/setlist.ts` beskriver intern ID, navn, monoton opprettelsestid for sortering og sang-ID-er (tom liste i denne leveransen). Setlisteoperasjonene eies av `storage/songs.ts` og bekreftes ved transaksjonens fullføring. Navneendring leser og oppdaterer bare navnet på gjeldende post; sletting bruker bare setlistelageret. Hver gjennomført innlesing oppretter UUID. Samme filnavn med filendelse krever bekreftelse på kopi før ny oppføring lagres. `domain/import.ts` vurderer bare filnavn og er uavhengig av dialog/lagring; senere kildeidentitet kan utvide vurderingen. En sang inneholder `id`, `songbookId`, autoritativ `original`, avledet `title`/`key` og `origin` med `kind`, `filename`, `importedAt` samt plass til `provider`, `sourceId`, `fileId`, `relativePath`. Originalen beholder BOM, linjeskift og ukjente direktiver. Parseren arbeider med en separat representasjon, som ikke skrives tilbake.

`personal` inneholder `songId`, formatversjon 3, capo, stemming, separate notater og markeringer, eventuelt `chordGrid` som separat klingende ChordPro-tekst for personlig skjema og et kart `chorus` fra deterministisk originallinjereferanse (`line:N`, nullbasert) til boolsk tilstand. Det er separat fra originalinnholdet. Utkast, transaksjonell lagring og ankere er beskrevet under «Personlige tilpasninger». Felles koordinathåndtering ved endret original finnes; ekstern synk er senere arbeid. localStorage-nøkkelen `<namespace>:display` inneholder `fontSize`, `showGrids` og `showDynamics` samt normalisert `theme: dark`. Eksisterende innstillinger uten de nye feltene beholder tema/størrelse og får begge visningene på. Appens oppstart bruker miljøets innstillinger før innholdet vises. Ingen lagringsnavn følger SHA/PR.

`songStorage.library()` leser sanger, bøker og capo/stemming fra én konsistent readonly-transaksjon. Persondata projiseres til nødvendige metadata uten redigeringsøkter eller skriving. Listen viser sist lagrede verdier og leses på nytt ved retur. En generasjonsteller forkaster foreldede leseresultater. Valgt sangbok lagres separat under `<namespace>:songbook-filter`; tom streng betyr Alle, og manglende bok faller tilbake til Alle. Fil-/kildeidentitet beholdes uavhengig av sangbok.

Databaseoperasjoner lukker forbindelsen etter fullført transaksjon. Innlesing regnes først som lagret ved `oncomplete`; `add` kan ikke overskrive en eksisterende sang. Blokkert/avvist åpning, abort og innstillingsfeil vises uten nullstilling. Ingen database-/brukerdatasletting skjer ved appstart eller oppdatering. Testharness bruker egne `-harness`-databaser; workeroppdatering prøves også med faktiske sanger og personlige valg.

Begge miljøer og andre Pages-prosjekter deler `geirskoglund.github.io`-origin. Navn/scopes hindrer utilsiktet kollisjon; script på samme origin er ikke sikkerhetsisolert fra andre miljøer. Nettleserprofil, privatmodus og en ny hjemskjerminstallasjon kan ha annen lagring. Ingen automatisk kopiering mellom test og prod.

## Offline og oppdatering

`vite-plugin-pwa`/Workbox genererer hver sin `sw.js` med lokale JS/CSS/HTML/ikoner/manifest/byggmetadata i precache. Fallback gjelder navigasjon bare under eget miljø. Ingen root-worker for `/hobos-songbook/`, ingen runtime-cache av Dropbox eller eksterne tjenester. Workbox rydder foreldede ressurser i egen precache ved aktivering; bred `cleanupOutdatedCaches` er av.

Et første nettbesøk må fullføre caching/worker-oppsett før offline loves. Startsiden viser når skallet er klart. Manglende workerstøtte eller registreringsfeil gir ingen falsk offline-klar status. Cache-/nettleserdata kan fortsatt slettes/evikteres av plattformen; de er ikke backup.

`src/app-updates.ts` registrerer den genererte workeren med nettleserens service-worker-API og `updateViaCache: none`. Kontroller skjer ved oppstart, når appen får fokus/blir synlig, ved nettilbakekomst og hvert minutt mens den er synlig og på nett. «Se etter oppdatering» kan også brukes manuelt. En ferdig nedlastet, ventende worker med bekreftet annen byggidentitet gir et fast, tilgjengelig varsel med «Oppdater nå», også mens brukeren leser langt nede i en sang eller har lukket appinformasjonen.

`src/worker-build.ts` spør den aktuelle workeren via `MessageChannel` om dens innbakte byggmetadata. Vite genererer en liten `worker-build-<hash>.js` med miljøets eksakte metadata; den importeres av workeren og caches offline. Filnavnet følger metadataene slik at gammel HTTP-cache ikke kan gi en ny worker feil versjon. Varsel krever forskjell i SHA/PR i samme miljø, ikke bare `waiting`/`controllerchange`. En fersk side med eldre controller, overtakelse fra en worker med samme bygg og repakking av samme versjon gir ikke ny-versjon-varsel. Manglende eller ugyldig svar gir ingen påstand om ny/siste versjon. Eksisterende controller ved sidestart behandles ikke som en ny utgave.

Aktivering krever et eksplisitt trykk. Appen sender `SKIP_WAITING` til den ventende workeren og laster siden på nytt når akkurat denne workeren overtar kontrollen. Dette gjelder også oppdatering i første appøkt uten tidligere omlasting. Dersom en annen fane i samme miljø aktiverer den, får den eksisterende siden tilbud om omlasting og fortsetter å vise sitt innhold inntil brukeren velger. Manglende aktivering gir en tidsavgrenset feil med mulighet for nytt forsøk. Sanger/innstillinger slettes ikke, og søskenmiljøet navigeres ikke. Oppdateringsstyrt omlasting avventer pågående samlet lagring. Råtekstutkast, ugyldige verdifelt, mislykket autosparing og ulagret ny sang inngår i dirty-vernet. Ulagret arbeid eller lagringsfeil beholder editoren og stopper omlasting.

Alle oppdateringsstyrte omlastinger bruker samme callback fra appvisningen. `src/ui/update-view.ts` lagrer et engangsøyeblikksbilde under miljøets nøkkel i den aktuelle historioppføringen med `history.replaceState`, uten å legge til en tilbake-oppføring. Det omfatter valgt sang-ID eller oversikt, lesested, frigjort sticky-skjema, aktiv hovedside, menyens åpne/lukkede tilstand, meny-scroll, sangretur, valgt setliste-ID, retur til setlisteoversikten og fokus. Øyeblikksbildet er avgrenset til fanen og miljøet og kopierer ikke originaltekst. Ved oppstart forbrukes det én gang. Etter at data og layout er klare, gjenopprettes synlig innholdsrad med relativ plassering, slik at ny ombrekking ikke flytter brukeren til en annen del av teksten. Manglende rad bruker lagret scrollposisjon; manglende sang gir oversikten. Ugyldig eller utilgjengelig historikk hindrer ikke appoppdatering. Vanlig ny åpning eller bevisst sideomlasting uten oppdateringsøyeblikksbilde følger ordinær startflyt.

## Publisering

Bare `pages.yml` fra standardbranch styrer Pages. Plan og deploy kjører eksakt validert master-infrastruktur, mens CI validerer hver kildecommit én gang og lagrer ferdige, pinnede miljøbygg. Lesende klargjøringsjobber henter bare data fra riktig valideringskjøring eller gjenbruker uendret publisert kanal. Tokanal-artifacts valideres som data før ett nettsted settes sammen. `build-files.json` i hver kanal lister alle filer med størrelse og SHA-256. Bare en manglende inventarfil (eldre publisering) tillater reserveflyt; korrupt innhold stopper. Eldre kilder uten tilgjengelig CI-artifact eller publisert inventar kan bygges og valideres én gang i en jobb uten deployrettigheter. Rootens `deployment.json` bevarer kilder/testvalg; `build-info.json` identifiserer hvert appbygg.

Ingen direkte push-deploy kan vinne over master-CI. Riktig workflow-ID/-sti, repo/kilderepo, hendelse, SHA og vellykket valideringsjobb kreves. For bevart test etter lukket PR kan GitHub fjerne PR-lenken fra Actions-resultatet; da gjenfinnes kildebindingen fra GitHubs commit/PR-assosiasjon for den lukkede samme-repo-PR-en. Dette gir ingen tillatelse til å velge en ny lukket PR til test.

Produksjon bruker bare master; test beholder valgt eksakt commit også etter merge/branchsletting. Før appskallet finnes på master kan produksjon være en betrodd oppstartsplassholder, mens PR-appen bare publiseres til test. [TESTING](TESTING.md) beskriver valg, minste rettigheter, feil, første oppsett og HTTPS-kontroll.

## Videre domene og lokal lagring

Intern sangidentitet, originaltekst, opprinnelse og personlige tilpasninger finnes nå. Private arbeidskopier, setlisteinnhold og tokenlagring får versjonerte utvidelser ved senere funksjonsimplementering.

- Kildesang, privat arbeidskopi og personlig lag er ulike ansvar. Synk overskriver ikke upublisert arbeid. Tekstoppdateringer går gjennom `reconcilePersonal`: notater beholder posisjonen og sikre markeringer justeres; usikre markeringer kan falle bort uten egen konflikt-/historikkflyt. Den fremtidige synkadapteren må bruke samme oppdateringsfunksjon før ny original lagres.
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

`chart-dock.ts` gir samme kompakte flate for begge kilder, med sticky i fremføring og ordinær plassering under redigering. En synlig pin-knapp veksler mellom sticky og ordinær plassering i dokumentet, med pin-on/pin-off, oppdatert handlingsnavn og aria-pressed. Frigjort pin er fortsatt betjenbar. Innhold og høyde beholdes, og fokus blir på samme knapp uten automatisk scrolling. Komponentens callback oppdaterer gjeldende visningstilstand begge veier; engangsøyeblikksbildet ved appoppdatering gjenoppretter aktuell tilstand og riktig ikon. Tilstanden skrives ikke til sang/persondata; neste ordinære sangåpning har sticky på igjen. Under redigering er sticky av og pin-knappen skjult. ResizeObserver/vindusendring tilpasser høyden ved behov med samlet skalering, uten indre scroll. Observatører og hendelseslyttere fjernes ved bytte/lukking av sang.

`song-spacing.ts` samler avledede blanklinjemarkører til én kompakt pause på en halv tekstlinje før neste synlige innhold. CSS bruker 1,2 linjeavstand og samme mål i `--reader-line`, med tett akkordrekke. Uten blanklinje i kilden settes ingen ekstra avstand, også mellom kommentarer og refreng. Markørene opptar ingen egen høyde; skjulte refreng tas ikke med. Normaliseringen gjentas ved folding, og CSS-variabler følger skriftvalget uten å endre originaltekst eller parserdata.

`dynamics-profile.ts` tegner én sammenhengende SVG-sti i sanginnholdets 30 px venstremarg. Venstrekanten ligger fast ved x=0; bare høyrekanten følger nivåbredder 5/10/15/20/25 CSS-piksler. Tittel og akkordskjema ligger utenfor margen. Parserens avledede `hasDynamics` registrerer gyldige dynamikktagger, også inne i grid/refreng; dette lagres ikke på sangposten. Uten tagger opprettes ingen SVG/marg. CSS fjerner marg og profil ved global av eller viewport under 320 px. Nivåer kommer fortsatt fra de eksisterende avledede instruksjonene (default 3 før første tagg). Lokale Bézier-overganger runder bare høyrekantens skifter. Synlige rader gir vertikal plassering, og skjulte refreng endrer ikke nivået etter henvisningen. ResizeObserver og observasjon av sammenfolding holder høyden oppdatert. Profilen følger sangens layout, ikke en musikalsk tidsakse; tekststørrelse påvirker ikke breddene.

Visningsvalg leses fra den eksisterende miljønøkkelen og gjelder både personlig/felles skjema. Ingen sang-/databaseskjemaoppgradering er nødvendig. En egen innstillingsside samler visningsvalg og appstatus; hovedmenyen inneholder bare navigasjon. Oppdateringsmodulen finner de samme kontroll-ID-ene og fortsetter å vise reelle oppdateringsvarsler utenfor menyen.

## Sangøkt, kildehandlinger og autosparing (#30)

`domain/source-edit.ts` knytter logiske linjer, direktiver, akkordtoken og refreng-/gridgrenser til offset i den eksakte kilden. Handlinger skriver avgrensede kildeområder; parser og DOM er avledet visning og serialiseres aldri tilbake som original. Ukjente direktiver, BOM, blandede linjeskift, aliaser og uberørt whitespace bevares. `mergeRawSource` gjenbruker uendrede kildelinjer fordi textarea normaliserer linjeskift. `domain/original.ts` eier bare ny sang, avledet metadata og taktvalidering; det gamle brede refreng-/strukturvernet og den formaterte modalmodellen er fjernet.

`domain/edit-session.ts` eier gjeldende sang/persondata, felles undo/redo, kontrollgrupper og sist faktisk lagrede snapshot. Ett kontrollbesøk kan autospares flere ganger og forbli ett angresteg. Undo/redo gjenoppretter original og tilhørende persondata samlet, mens refrengfolding bevares som visningsvalg. Ny handling forkaster gjør-om-grenen. Avbrutt råtekstforsøk kan tilbakeføre gruppen uten å gjøre forkastet arbeid tilgjengelig igjen. Økten lever gjennom fane-/modusbytte og midlertidig Innstillinger-retur, og ryddes når sangen forlates.

`songbook.ts` har én seriell autosparingskø. Hver gjennomført transaksjon flytter baseline bare til innsendt snapshot; videre endringer under skriving tømmes før køen er ferdig. `saveDraft` bruker én readwrite-transaksjon over songs/personal, leser nyeste poster, sjekker originalbaseline og anvender bare endrede personfelt. Uberørt kilde, sangbok, ID, opprinnelse, andre faners data og setlister beholdes. Ny sang bruker add, og først oncomplete bekrefter varig lagring. Feil beholder tilstand og gir nytt forsøk. Ingen databaseversjon eller namespace endres av #30; dagens versjon 3 videreføres.

`ui/song-editor.ts` eier to verktøyfaner, kildehandlinger, presis plassering og Fjern på den felles sangflaten. Den samme renderer brukes i begge modi. `ui/value-controls.ts` gjenbruker D07/D08 med numerisk/tekstlig variant. Store skjemaredigerere bruker samme felles dialogramme/footer med kildeparameter og capo-omregning. Felles akkorder og begge grid lagres klingende. Toneartsendring oppdaterer inline-akkorder, alle felles grid og personlig grid én gang i samme historikk-/lagringshandling. Direkte råtekstendring av key har ingen slik sideeffekt.

`ui/original-editor.ts` er fullskjerms Råtekst med ti taggknapper og egen Avbryt/Lagre-grense. `ui/text-edit.ts` holder skriving, innliming og programmatisk tagginnsetting i én lokal teksthistorikk. `ui/dialog.ts` gir en eksplisitt lokal fokusbevaringsvariant; `app-interactions.ts` unntar disse knappene fra global fjerning av tekstutvalg. Tastaturbetjening bevarer siste skriveposisjon og returnerer feltfokus. Ingen skjult lagring skjer ved taggtrykk eller Avbryt. Første vellykkede Råtekst-Lagre oppretter en ny lokal sang og viser den aktive sangredigeringen under.

## Personlige data, forekomster og geometri

`personal` bruker fortsatt formatversjon 3. Notater har stabil egen ID, tekst og fast nummerert logisk linjeposisjon. Nummereringen inkluderer eksplisitte innholdslinjer/blanklinjer og refrengforekomster, men ikke metadata, dynamikktagger, grid eller skjermbryting. Manglende posisjoner/kollisjoner legges nederst i stabil rekkefølge uten å slette notattekst. Uten tekst kan alle notater fortsatt redigeres/flyttes. `note-drag.ts` bevarer hold/dra, kant-scroll, avbrudd, opptatte mål og tastaturalternativ.

Gulmarkeringer bruker forekomst/kildelinje og halvåpne UTF-16-tegnspenn uten akkorder. groupId binder flerlinjeutvalget sammen. `reconcilePersonal` justerer sikre koordinater ved originalendring og fjerner usikre markeringer; det finnes ingen kopiert originaltekst/hash/kontekst i ankrene. Refrengvalg remappes ved kildeendringer fremfor å følge tilfeldige linjenumre. `cleanPersonal` rydder gamle testannoteringer og tomme poster ved lagringsgrensen og bevarer øvrige felt.

`highlight-editor.ts` gjenbruker appstyrt utvalg/endehåndtak og krever verktøy først i sangeditoren. Det gamle frittstående slettekrysset brukes ikke; Fjern lager én kontroll per markert gruppe. `ui/annotations.ts` renderer alle notater og måler F05-forankringen fra siste faktiske teksttegn til notatets midtpunkt. Resize-/mutasjonsobservasjon og fontlasting oppdaterer forbindelsen i begge modi. Under redigering tegnes eksplisitte dynamikktagger som individuelle markører, og profilen skjules. Profilens eksisterende nivå-/geometrimodell i Visning beholdes.

Appoppdatering venter på lagringskøen og beskytter ubekreftet råtekst, ugyldige verdifelt og feil. Visningstilstand, lesested og miljøgrenser gjenbruker eksisterende oppdateringsadapter. Varig versjonshistorikk, ekstern arbeidskopimarkering, eksport, Dropbox og synk er senere arbeid.
