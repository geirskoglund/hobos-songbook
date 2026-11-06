# Arkitektur

## Implementert app og sanggrunnlag

Statisk HTML/CSS/TypeScript bygges med Vite. Ingen backend, skydatabase, autentisering, Dropbox-SDK eller CDN-ressurs brukes ved kjøring. Avhengighetsfilen låser verktøyene. De lokale PNG-ikonene har separate produksjons-/testvarianter; testbildet har «TEST». `scripts/generate-icons.mjs` gjenskaper dem uten nettavhengighet.

| Del | Ansvar nå | Grense mot senere arbeid |
| --- | --- | --- |
| `index.html`, `src/main.ts`, `src/app-updates.ts`, `src/style.css`, `src/ui/` | Sanginnlesing, enkel oversikt/lesevisning, miljømerking og workerstatus | Fullverdig bibliotek/editor/setlister kommer senere |
| `src/domain/{song,chordpro,grid,song-grid}.ts` | Sangmodell, UTF-8-validering og avledet ChordPro-tolkning | Ingen DOM- eller leverandøravhengighet |
| `src/environment.ts` | Én validert miljøkonfigurasjon | ID-er/scopes/navn følger miljø; SHA/PR er bare byggmetadata |
| `src/storage/{songs,preferences,local-settings}.ts` | IndexedDB-sanger/personlig refrengtilstand og miljøavgrensede visningsvalg | Ingen ekstern lagring; fremtidige skjemaversjoner oppgraderes additivt |
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

`personal` inneholder `songId`, eventuelt `chordGrid` som separat ChordPro-tekst for personlig skjema, og et kart `chorus` fra deterministisk originallinjereferanse (`line:N`, nullbasert) til boolsk tilstand. Det er separat fra sanginnholdet. Editor/synk må senere håndtere gjenforankring ved tekstendring. localStorage-nøkkelen `<namespace>:display` inneholder globalt `theme`, `fontSize`, `showGrids` og `showDynamics`. Eksisterende innstillinger uten de nye feltene beholder tema/størrelse og får begge visningene på. Appens oppstart bruker miljøets innstillinger før innholdet vises. Ingen lagringsnavn følger SHA/PR.

Databaseoperasjoner lukker forbindelsen etter fullført transaksjon. Innlesing regnes først som lagret ved `oncomplete`; `add` kan ikke overskrive en eksisterende sang. Blokkert/avvist åpning, abort og innstillingsfeil vises uten nullstilling. Ingen database-/brukerdatasletting skjer ved appstart eller oppdatering. Testharness bruker egne `-harness`-databaser; workeroppdatering prøves også med faktiske sanger og personlige valg.

Begge miljøer og andre Pages-prosjekter deler `geirskoglund.github.io`-origin. Navn/scopes hindrer utilsiktet kollisjon; script på samme origin er ikke sikkerhetsisolert fra andre miljøer. Nettleserprofil, privatmodus og en ny hjemskjerminstallasjon kan ha annen lagring. Ingen automatisk kopiering mellom test og prod.

## Offline og oppdatering

`vite-plugin-pwa`/Workbox genererer hver sin `sw.js` med lokale JS/CSS/HTML/ikoner/manifest/byggmetadata i precache. Fallback gjelder navigasjon bare under eget miljø. Ingen root-worker for `/hobos-songbook/`, ingen runtime-cache av Dropbox eller eksterne tjenester. Workbox rydder foreldede ressurser i egen precache ved aktivering; bred `cleanupOutdatedCaches` er av.

Et første nettbesøk må fullføre caching/worker-oppsett før offline loves. Startsiden viser når skallet er klart. Manglende workerstøtte eller registreringsfeil gir ingen falsk offline-klar status. Cache-/nettleserdata kan fortsatt slettes/evikteres av plattformen; de er ikke backup.

`src/app-updates.ts` registrerer den genererte workeren med nettleserens service-worker-API og `updateViaCache: none`. Kontroller skjer ved oppstart, når appen får fokus/blir synlig, ved nettilbakekomst og hvert minutt mens den er synlig og på nett. «Se etter oppdatering» kan også brukes manuelt. En ferdig nedlastet, ventende worker med bekreftet annen byggidentitet gir et fast, tilgjengelig varsel med «Oppdater nå», også mens brukeren leser langt nede i en sang eller har lukket appinformasjonen.

`src/worker-build.ts` spør den aktuelle workeren via `MessageChannel` om dens innbakte byggmetadata. Vite genererer en liten `worker-build-<hash>.js` med miljøets eksakte metadata; den importeres av workeren og caches offline. Filnavnet følger metadataene slik at gammel HTTP-cache ikke kan gi en ny worker feil versjon. Varsel krever forskjell i SHA/PR i samme miljø, ikke bare `waiting`/`controllerchange`. En fersk side med eldre controller, overtakelse fra en worker med samme bygg og repakking av samme versjon gir ikke ny-versjon-varsel. Manglende eller ugyldig svar gir ingen påstand om ny/siste versjon. Eksisterende controller ved sidestart behandles ikke som en ny utgave.

Aktivering krever et eksplisitt trykk. Appen sender `SKIP_WAITING` til den ventende workeren og laster siden på nytt når akkurat denne workeren overtar kontrollen. Dette gjelder også oppdatering i første appøkt uten tidligere omlasting. Dersom en annen fane i samme miljø aktiverer den, får den eksisterende siden tilbud om omlasting og fortsetter å vise sitt innhold inntil brukeren velger. Manglende aktivering gir en tidsavgrenset feil med mulighet for nytt forsøk. Sanger/innstillinger slettes ikke, og søskenmiljøet navigeres ikke. Senere redigeringsøkter trenger egne vurderinger før oppdateringsflyten utvides.

## Publisering

Bare `pages.yml` fra standardbranch styrer Pages. Plan og deploy kjører eksakt validert master-infrastruktur, mens appkildene bygges fra pinnede SHA-er i separate lesende jobber. Tokanal-artifacts valideres som data før ett nettsted settes sammen. Rootens `deployment.json` bevarer kilder/testvalg; `build-info.json` identifiserer hvert appbygg.

Ingen direkte push-deploy kan vinne over master-CI. Riktig workflow-ID/-sti, repo/kilderepo, hendelse, SHA og vellykket valideringsjobb kreves. For bevart test etter lukket PR kan GitHub fjerne PR-lenken fra Actions-resultatet; da gjenfinnes kildebindingen fra GitHubs commit/PR-assosiasjon for den lukkede samme-repo-PR-en. Dette gir ingen tillatelse til å velge en ny lukket PR til test.

Produksjon bruker bare master; test beholder valgt eksakt commit også etter merge/branchsletting. Før appskallet finnes på master kan produksjon være en betrodd oppstartsplassholder, mens PR-appen bare publiseres til test. [TESTING](TESTING.md) beskriver valg, minste rettigheter, feil, første oppsett og HTTPS-kontroll.

## Videre domene og lokal lagring

Intern sangidentitet, originaltekst, opprinnelse og personlig refrengtilstand finnes nå. Private arbeidskopier, annoteringer, setlister og tokenlagring får egne versjonerte utvidelser ved senere funksjonsimplementering.

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

`src/domain/song-grid.ts` velger ett innhold til den felles skjemavisningen: `personal.chordGrid` når det finnes, ellers alle originale gridblokker i kilderekkefølge (uten kopier fra refrenghenvisninger), ellers ingen. Personlig innhold er separat og brukes uendret som inngang til samme parser/renderer. Fremtidig opprettelse/redigering er ikke bygget. Inline-grid utelates fra selve tekstflaten, men dynamikkinstruksjoner der beholder sin musikalske virkning i sangen.

`chart-dock.ts` gir samme kompakte, sticky flate for begge kilder. Lokal ×-tilstand lagres ikke, og tilbakestilles ved neste åpning. ResizeObserver/vindusendring tilpasser høyden ved behov med samlet skalering, uten indre scroll. Observatører og hendelseslyttere fjernes ved bytte/lukking av sang.

`dynamics-profile.ts` tegner én lukket, symmetrisk SVG-sti over hele tekstområdets høyde. Fem bredder skaleres innenfor et smalt felt på høyst 112 px / 22 prosent av leseområdet. Nivåer kommer fortsatt fra de avledede instruksjonene (default 3); lokale Bézier-overganger runder skiftene uten automatisk crescendo. Synlige rader gir plassering; skjulte refreng endrer ikke det beregnede nivået etter henvisningen. ResizeObserver og observasjon av sammenfolding holder formen oppdatert. Dette er layoutgeometri, ikke en tidsakse.

Visningsvalg leses fra den eksisterende miljønøkkelen og gjelder både personlig/felles skjema. Ingen sang-/databaseskjemaoppgradering er nødvendig. En tilgjengelig menydialog samler innstillinger og appstatus. Oppdateringsmodulen finner de samme kontroll-ID-ene og fortsetter å vise reelle oppdateringsvarsler utenfor menyen.
