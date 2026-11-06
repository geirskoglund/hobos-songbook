# Arkitektur

## Implementert appskall

Statisk HTML/CSS/TypeScript bygges med Vite. Ingen backend, database, autentisering, Dropbox-SDK eller CDN-ressurs brukes ved kjøring. Avhengighetsfilen låser verktøyene. De lokale PNG-ikonene har separate produksjons-/testvarianter; testbildet har «TEST». `scripts/generate-icons.mjs` gjenskaper dem uten nettavhengighet.

| Del | Ansvar nå | Grense mot senere arbeid |
| --- | --- | --- |
| `index.html`, `src/main.ts`, `src/style.css` | Responsiv startside, miljømerking, workerstatus og oppdatering | Ingen sang-/bibliotek-/setliste-UI eller falske demokontroller |
| `src/environment.ts` | Én validert miljøkonfigurasjon | ID-er/scopes/navn følger miljø; SHA/PR er bare byggmetadata |
| `src/storage/local-settings.ts` | Liten namespace-grense for fremtidige lokale innstillinger, prøvd uten produktdata | Ingen sangdatabase/skjema eller migrering levert; adapteren har ingen ekstern lagring |
| `vite.config.mjs` | Miljøstier, manifest, lokale ikoner, `build-info.json` og Workbox-worker | Bygget er selvstendig under miljøets sti |
| `scripts/{pages-plan,github-pages,build-channel,assemble-pages,verify-pages}.mjs` | Betrodd CI/CD-kontrakt | PR-bygg kjøres ikke med deploymentrettigheter |
| `tests/*.test.mjs`, `tests/e2e` | Kilde-/miljø-/publiseringskontrakter og ekte nettleser/offline | Produktfunksjoner og fysiske plattformer er senere verifikasjon |

Nye domenemoduler kan legges under `src/domain/`, lokal vedvarende lagring under `src/storage/` og leverandørtilkobling under `src/adapters/`. Disse grensene er arkitekturretning, ikke et forhåndsimplementert pluginrammeverk eller tomme krav om en omfattende lagdeling. Domenet skal ikke importere Dropbox-API/-SDK.

## Miljøidentitet og data

| Egenskap | Produksjon | Test |
| --- | --- | --- |
| Pages-sti, worker-scope | `/hobos-songbook/app/` | `/hobos-songbook/test/` |
| Appnavn/short_name | Hobo's Songbook | Hobo's Songbook Test |
| Stabil namespace/cache-ID | `hobos-songbook-production` | `hobos-songbook-test` |
| Fremtidig IndexedDB-navn | `hobos-songbook-production` | `hobos-songbook-test` |
| localStorage-prefiks | `hobos-songbook-production:` | `hobos-songbook-test:` |
| Manifest `id/start_url/scope` | `./`, løst til app-stien | `./`, løst til test-stien |

Appen oppretter foreløpig ingen produktdatabase eller personlige data. Nettlesertestene bruker testmarkører i ekte localStorage og IndexedDB på de avtalte navnene for å prøve oppdatering/isolasjon uten å levere sangfunksjoner. Den lille innstillingsgrensen prøver navneavgrensning separat.

Begge miljøer og andre Pages-prosjekter deler `geirskoglund.github.io`-origin. Navn/scopes hindrer utilsiktet kollisjon; script på samme origin er ikke sikkerhetsisolert fra andre miljøer. Nettleserprofil, privatmodus og en ny hjemskjerminstallasjon kan ha annen lagring. Ingen automatisk kopiering mellom test og prod.

## Offline og oppdatering

`vite-plugin-pwa`/Workbox genererer hver sin `sw.js` med lokale JS/CSS/HTML/ikoner/manifest/byggmetadata i precache. Fallback gjelder navigasjon bare under eget miljø. Ingen root-worker for `/hobos-songbook/`, ingen runtime-cache av Dropbox eller eksterne tjenester. Workbox rydder foreldede ressurser i egen precache ved aktivering; bred `cleanupOutdatedCaches` er av.

Et første nettbesøk må fullføre caching/worker-oppsett før offline loves. Startsiden viser når skallet er klart. Manglende workerstøtte eller registreringsfeil gir ingen falsk offline-klar status. Cache-/nettleserdata kan fortsatt slettes/evikteres av plattformen; de er ikke backup.

Oppdatering er en enkel prompt-flyt: «Se etter oppdatering», deretter «Oppdater appen» når ny worker er klar. Den nye workeren aktiveres og siden lastes på nytt. Ingen localStorage-/IndexedDB-sletting, automatisk ny navigasjon i søskenmiljøet eller avansert funksjonell oppdaterings-UI fra referanseprosjektet. Senere redigeringsøkter trenger egne vurderinger før oppdateringsflyten utvides.

## Publisering

Bare `pages.yml` fra standardbranch styrer Pages. Plan og deploy kjører eksakt validert master-infrastruktur, mens appkildene bygges fra pinnede SHA-er i separate lesende jobber. Tokanal-artifacts valideres som data før ett nettsted settes sammen. Rootens `deployment.json` bevarer kilder/testvalg; `build-info.json` identifiserer hvert appbygg.

Ingen direkte push-deploy kan vinne over master-CI. Riktig workflow-ID/-sti, repo/kilderepo, hendelse, SHA og vellykket valideringsjobb kreves. For bevart test etter lukket PR kan GitHub fjerne PR-lenken fra Actions-resultatet; da gjenfinnes kildebindingen fra GitHubs commit/PR-assosiasjon for den lukkede samme-repo-PR-en. Dette gir ingen tillatelse til å velge en ny lukket PR til test.

Produksjon bruker bare master; test beholder valgt eksakt commit også etter merge/branchsletting. Før appskallet finnes på master kan produksjon være en betrodd oppstartsplassholder, mens PR-appen bare publiseres til test. [TESTING](TESTING.md) beskriver valg, minste rettigheter, feil, første oppsett og HTTPS-kontroll.

## Senere domene og lokal lagring

Planlagt lokal IndexedDB lagrer intern sangidentitet separat fra kilde/ekstern filidentitet, sangtekst/versjonskontekst, private arbeidskopier, annoteringer og setlister. Konkrete skjemaer, atomiske transaksjoner, migreringer og tokenlagring bestemmes ved funksjonsimplementering; ingenting av dette er ferdig i skallet.

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
