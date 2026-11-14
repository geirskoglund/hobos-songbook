# Kontroll og publisering

## Leveransegrense og kontroll

Kodebasen har PWA/offline, miljøisolasjon og CI/CD, lokal sanglagring og kompakt ChordPro-visning fra issue #4, generell bevaring av lesested og Android-scrollregel fra #6 samt samlet sangredigering med lokal autosparing, felles historikk, musikalske verktøy og Råtekst/ny sang fra #30. Sangbokfilter og setlisteoversikt med lokal navneadministrasjon/tom detaljside er også implementert. Lokal sangbokadministrasjon og obligatorisk bokvalg ved Opprett/Importer er implementert i #35; eksterne kilder, konvertering, setlisteinnhold og Dropbox er senere arbeid. Funksjons-PR-er trenger brukertest på fast testadresse og uttrykkelig mergegodkjenning.

Node.js 24 LTS og låst npm-fil brukes lokalt og i Actions. Eksempel på full kontroll ved behov:

```sh
npm ci
npx playwright install chromium
npm run check
npm run build
```

`npm run check` kjører TypeScript-kontroll, JavaScript-syntaks, Node-kontrakttester og Playwright. `npm test` kjører bare kontrakttestene. Disse prøver første oppsett, eksakt workflow-/repo-/hendelses-/SHA-bevis, ugyldige/stale PR-er, mastervalidering, bevart testcommit også etter lukket PR, metadatafeil, faktisk feilende npm-validering, artifactkontroll og HTTPS-etterkontroll. Kontraktfixtures er atskilt fra de reelle appbyggene i Playwright.

`npm run test:e2e` bygger begge faktiske miljøer og to nye oppdateringer, og prøver dem under de nøyaktige `/hobos-songbook/app/`- og `/hobos-songbook/test/`-stiene på én origin. Det prøves 320px mobil, nettbrett og desktop, lokal ressurslasting, manifestidentiteter/ikonstørrelser, egne worker-scopes og caches, lukking/gjenåpning offline, localStorage-/IndexedDB-markører, bytte av PR/commit og oppdatering av begge miljøer mens søskenmiljøet er åpent. En uvedkommende cache beholdes som kontroll. Før-merge-sammensetning med ekte testapp og betrodd produksjonsplassholder prøves også. Markørdatabaser er separat testharness (`<namespace>-harness`). Den samme workerflyten kontrollerer også faktiske sanger, ID-er, originaltekst og personlige valg i produktets IndexedDB-skjema.

Playwright bruker pinnet Chromium når installert. `CHROMIUM_PATH=/usr/bin/chromium npm run check` kan bruke en tilgjengelig systemnettleser; ellers velges installert Chromium/Google Chrome på kjente systemstier. CI installerer pinnet Playwright-nettleser. Bare den historiske reserveflyten kan kjøre en ekstra isolert sjekk med hosted-runnerens system-Chrome. Rapporter nettleserversjonen ved konkret verifikasjon. Browserbinær og npm-pakker må være installert/cachet før full offline-kontroll; selve appen har ingen kjøretidsnettavhengighet.

`Validate / validate` kjører automatisk på PR og master. Ved PR sjekkes PR-hodets SHA ut, ikke en midlertidig mergecommit. Bare den eksakte validerte kilden kan publiseres. Første bootstrap-deploy er et eget infrastrukturbevis, ikke fysisk PWA-verifikasjon.

## GitHub-oppsett

1. Standardbranch er `master`. Bootstrap og videre arbeid leveres via PR; merge krever produktansvarligs uttrykkelige godkjenning.
2. Settings → Actions → General: tillat de offisielle checkout, setup-node, github-script, artifact og Pages-actions som workflowene bruker. Behold minste standardrettighet. Ingen Dropbox-secret, frontend App secret eller personlig token kreves.
3. Settings → Pages → Source: **GitHub Actions**. Bruk ett Pages-nettsted uten custom domain. Faktisk deployment og HTTPS må kontrolleres etter første godkjente merge og ved senere leveringer.
4. Environment `github-pages` må tillate workflow fra master. Eventuell ventende environment-godkjenning må håndteres før deploy kan fullføres. Ikke innfør en slik sperre som utilsiktet hindrer automatisk publisering etter godkjent merge.
5. Når første CI er kjørt: krev PR og den reelle kontrollen `Validate / validate` på master, og hindre force push/sletting. Velg den faktiske kontrollen GitHub viser; ikke krev produksjonsdeploy før merge eller en ekstra reviewer som ikke finnes. Eier kan ikke godkjenne egen PR med GitHubs reviewfunksjon; dokumentert produktgodkjenning før merge gjelder likevel.

## Første publisering og senere testvalg

Bare `pages.yml` publiserer. Workflowen må finnes på master før `workflow_dispatch` og den etablerte `workflow_run`-flyten kan brukes. Etter godkjent bootstrap-merge publiseres først plassholdere etter grønn mastervalidering. En 404 for `deployment.json` godtas som første oppsett bare når GitHub ikke har noen tidligere vellykket `github-pages`-deployment. API-/nettverksfeil og senere manglende/ugyldige metadata stopper publisering.

Faste mål under ett Pages-nettsted:

| Miljø | Adresse | Kilde |
| --- | --- | --- |
| Produksjon | https://geirskoglund.github.io/hobos-songbook/app/ | Eksakt validert master-commit |
| Test | https://geirskoglund.github.io/hobos-songbook/test/ | Én eksplisitt valgt PR eller en bevart master-commit |

Velg hoved-PR-en etter grønn Validate for gjeldende hode:

```sh
gh workflow run pages.yml --repo geirskoglund/hobos-songbook --ref master -f preview=PR_NUMMER
```

Alternativ: Actions → Deploy GitHub Pages → Run workflow → branch `master` → `preview=PR_NUMMER`. Bare en åpen samme-repo-PR mot master med gyldig appkontrakt kan velges. Nye grønne commits i valgt PR følger automatisk. Andre PR-er, forker, gamle valideringskjøringer og feilende utgaver overtar ikke test.

- `preview=keep` beholder sist publiserte **eksakte** test-SHA og PR-identitet. Master-merge og slettet PR-branch endrer ikke valget.
- `preview=master` velger dagens validerte master også til test. Valget følger ikke nye mastercommits automatisk; produksjon følger master, mens test fortsatt er pinnet.
- `preview=PR_NUMMER` velger eller gjenpubliserer gjeldende validerte PR-hode.

Kontroller Actions-resultat, rootens `deployment.json` og begge `build-info.json` før en testutgave oppgis som klar. Test vises på samme adresse gjennom hele implementeringsløpet. Hoved-PR-en holdes åpen for brukerens test og uttrykkelige mergegodkjenning.

## Betrodd kilde og tokanelbygg

Planlegging og deploy kjører bare script fra eksakt validert master. Produksjon får alltid master-SHA; PR-SHA kan bare bli test. Actions-bevis krever riktig `ci.yml`-workflow-ID/-sti, repo, kilderepo, hendelsestype, SHA, PR/base der relevant, og vellykket `validate`-jobb i nyeste aktuelle kjøring. Når GitHub fjerner Actions-kjøringens PR-kobling etter lukking, bevises en bevart kilde gjennom GitHubs commit/PR-assosiasjon for den lukkede samme-repo-PR-en. Nytt valg krever fortsatt åpen PR. En kontroll med et passende navn alene gir ingen tillatelse. Ved push til master venter Pages på vellykket Validate; det finnes ingen konkurrerende direkte push-deploy.

CI kjører én full validering og bygger deretter test for PR, eller produksjon og test for master. Miljøbyggene heter `validated-test` og `validated-production` og beholdes som Actions-artifacts i 90 dager. Avhengigheter og Playwright-nedlasting bruker cache; utdaterte CI-kjøringer for samme PR avbrytes.

Pages velger artifacts fra eksakt vellykket Validate-kjøring med eksisterende kildebevis. Et uendret miljø hentes fra sin publiserte adresse ved hjelp av `build-files.json`; alle filer kopieres byte for byte og kontrolleres mot størrelse og SHA-256. Dette virker også etter at Actions-artifactet er utløpt. Begge kanaler må fortsatt være med i ett samlet Pages-nettsted. Normal publisering kjører verken npm-installasjon, fulltest eller nytt appbygg.

Bare eldre kilder som mangler både publisert inventar og tilgjengelig artifact går gjennom tidligere bygg-/testflyt én gang. Den publiserte kanalen får da et inventar for senere gjenbruk. Ugyldig inventar, feil hash, utrygge stier, feil identitet eller nettverksfeil gir stopp, ikke automatisk ombygging.

Klargjøring kjører i separate jobber med `contents: read` og `actions: read`, uten Pages-/OIDC-skriverettigheter eller lagrede Git-credentials. Deploy-jobben kjører aldri PR-script eller npm fra appkilden. Den leser kun statiske byggartefakter med masterens validator, setter sammen `app/` og `test/` og publiserer ett Pages-artifact. Den serialiserte workflowen leser testvalget på nytt og kontrollerer master/PR-hode og valideringsstatus rett før deploy. Endring under bygg avviser planen; en ny kjøring må ta utgangspunkt i ny kilde.

Rootens versjonerte `deployment.json` lagrer repo, produksjons-/test-SHA, PR, byggtype og faste stier. Feil i eksisterende metadata stopper også et eksplisitt nytt valg. Publisering kjører ingen migrering eller sletting av lokal lagring. Når produksjonsappen først finnes, kan den ikke erstattes med oppstartsplassholder.

## Appbyggkontrakt

`app-build.json` med `{"version":1}` markerer et reelt appbygg. `npm ci`, `npm run check` og `npm run build` må fungere på eksakt SHA. Byggmiljøet er:

| Variabel | Verdi |
| --- | --- |
| `APP_CHANNEL` | `production` eller `test` |
| `APP_SHA` | Full 40-tegns kilde-SHA |
| `APP_PR` | PR-nummer eller tom streng for master |
| `APP_KIND` | `app` |

`npm run build` skriver selvstendige filer til `dist/`. Uten deploymentvariabler bygges test fra Git-HEAD, PR tom. Sett alltid variablene eksplisitt for leveransekontroll; produksjon avviser PR-nummer. Eksempel: `APP_CHANNEL=production APP_SHA=FULL_SHA APP_PR= npm run build`. `npm run dev` bruker teststien på port 5173, uten aktivert utviklings-worker; produksjonsbygg/e2e er offline-beviset.

- `build-info.json`: `{"version":1,"channel":"test","sha":"FULL_SHA","pr":7,"kind":"app"}` (master har `pr:null`).
- `index.html` har `id="app"`, korrekt `<title>` og apple-touch-icon. Testinngangen har synlig «Testversjon». Den reelle appen må vise PR/master og commit også etter oppstart.
- `manifest.webmanifest` har navn/short_name `Hobo's Songbook` eller `Hobo's Songbook Test`, `display:"standalone"` og relative `id`, `start_url`, `scope` lik `"./"`. Disse løses til hver sin faste søskenadresse.
- PNG-ikoner omfatter 192×192 og maskable 512×512; `apple-touch-icon.png` er 180×180. Manifestets ikonstier er enkle lokale PNG-filnavn. `sw.js` og alle kjøretidsressurser er lokale. Symlenker og skjulte filer godtas ikke i app-artifactet.
- Miljøkonfigurasjonen bruker stabile navn `hobos-songbook-production` og `hobos-songbook-test` for cache-/fremtidige lagringsnavn. Reelle service workers begrenses til egen sti, aldri `/hobos-songbook/`. Commit/PR er byggmetadata, ikke lagringsidentitet. Samme origin er ingen sikkerhetsgrense mot ondsinnet script.

Før hoved-PR-merge bygges `/app/` som masterens betrodde plassholder og bare `/test/` som PR-appen. Etter godkjent merge blir `/app/` master-appen, mens valgt eksakt testbygg beholdes. Begge reelle appbygg prøves automatisk sammen med ekte workere, separate lagringsmarkører og offline-gjenåpning. Fysisk installasjon/offline på iPad og en annen tilgjengelig plattform rapporteres separat fra Chromium.

## Manuell kontroll av PWA-grunnlaget

1. Åpne fast testadresse mens du er på nett. Kontroller «Testversjon», forventet PR og commit i appens meny mot PR-leveringen/`build-info.json`. Startsiden skal identifisere Hobo's Songbook og ha filvalg og oversikt over lokale sanger. Sangflyt og personlig redigering kontrolleres i forløpene nedenfor; setlisteoversikt/navneadministrasjon kontrolleres også som beskrevet nedenfor.
2. Vent på «Klart for bruk uten nett». Installer på hjemskjermen på iPad, åpne den installerte appen online og vent på samme status. Oppgi iPadOS-versjon, Safari/installert modus og commit. Chromium eller en simulert iPad-bredde er ikke fysisk iPad-bevis.
3. Lukk appen helt, slå på flymodus og åpne den installerte appen igjen. Navn, riktig testmiljø, tekst og oppdateringskontroll skal vises; «Uten nett» er forventet. Prøv også vanlig nettleser og en annen tilgjengelig plattform, og registrer OS/nettleser/installert modus separat.
4. Gå online igjen. Appen kontrollerer automatisk ved oppstart, fokus/synlighet, nettilbakekomst og hvert minutt mens den er synlig på nett. En ny versjon skal gi et fast varsel også langt nede i en sang og når appinformasjonen er lukket. «Se etter oppdatering» kontrollerer også manuelt. Når en ny testcommit er publisert, skal «Oppdater appen» ta i bruk den og vise ny commit. Ikke slett nettleserdata ved en eldre utgave; lukk/åpne mens du er på nett og bruk oppdateringskontrollen.
5. Meld konkret forløp, forventet/faktisk resultat, enhet/OS/nettleser/modus og PR/SHA. Rettelser gjøres i samme PR/testløp. Produktansvarlig gir uttrykkelig mergegodkjenning etter vurdering. Eventuelle uutførte fysiske kontroller skal oppgis, ikke kvitteres ut av CI.

## Kontroll av setlisteoversikt og navn (#28)

1. Opprett to setlister, også med samme navn. Kontroller at Lagre åpner den nyopprettede setlisten direkte med Setliste, tilbakepil og tom body, og at Tilbake viser riktig ny rad øverst med 0 sanger. Avbryt/tomt navn skal ikke opprette eller åpne en setliste. Start appen på nytt og prøv offline etter fullført caching.
2. Endre ett navn fra radmenyen, avbryt en ny endring og prøv Slett med både Avbryt og bekreftelse. Sang-/person-/sangbokdata skal være uendret.
3. Åpne en rad: Setliste, tilbakepil, hamburger og tomt innhold. Prøv Innstillinger-retur og Tilbake til riktig rad/posisjon. En reell appoppdatering skal bevare oversikt/detalj, valgt ID, posisjon og hovedmeny; ulagret navn må lagres/avbrytes før omlasting.
4. Prøv tastatur/Escape, navnefeltets appmeny, lange navn, siste rad og skjermtastatur ved 320 px, nettbrett og desktop. Registrer fysisk iPad/Safari, Android/Chrome og installert PWA separat.

`tests/e2e/setlists.spec.mjs` dekker lagring, v1-/v2-migrering, transaksjonsabort/nytt forsøk, offline/miljøskille, navigasjon, workeroppdatering og tilgjengelig betjening. Faktiske kjøreresultater rapporteres i PR-en. Eksisterende migreringstest dekker blokkert og avbrutt v1-oppgradering til gjeldende skjema.

## Etter merge

Som del av merge-jobben skal Codex kontrollere at tilknyttede issues som PR-en løser fullt ut, faktisk er lukket. Bruk GitHubs gjenkjente nøkkelord, for eksempel `Closes #N`, i PR-beskrivelsen når hele issuen løses. Etter bekreftet merge til `master` leses issue-statusen; hvis den fortsatt er åpen, lukkes den via GitHub-integrasjonen med begrunnelsen `completed`. Les statusen på nytt og bekreft PR-/issue-status i sluttrapporten. En delvis løst issue holdes åpen, og gjenstående arbeid oppgis. En PR som bare lukkes uten merge, skal ikke utløse lukking som fullført.

Etter godkjent merge kontrolleres master-CI, Pages-kjøring, produksjonens SHA og uendret test-SHA over HTTPS. Reell produksjonsinstallasjon/offline kan først prøves etter dette. Grunnfunksjoner i fremtidig v1 har egne tester: rekursiv Dropbox-lesing, identitet mellom kontoer, negativ tilgang, parser/konvertering, konflikt/synk/backup og `.setlist`-systemdeling på faktisk iPad/Android. Ingen av disse er utført av skallets tester.

## Feil og gjenpublisering

Feil i plan, validering, bygg, artifactkontroll eller sammensetning stopper før deploy og lar eksisterende nettsted stå. Endret master/nytt PR-hode under bygg avviser den gamle planen. Start en ny workflow etter grønn validering, med eksplisitt testvalg ved behov.

Etter deploy sammenlignes metadata, begge adresser og byggidentitet over HTTPS. For reelle apper kontrolleres også manifest/scope, ikoner og worker. Etterkontroll har avgrensede forsøk ved CDN-forsinkelse. En feil **etter** deploy er en etterkontrollfeil; nettstedet er ikke automatisk rullet tilbake.

Ved feilende testapp velges `preview=master` eller en kjent fungerende, validert åpen PR på nytt. Gjenpublisering av bevart testcommit bruker `keep`. En feil i produksjon rettes/reverteres via godkjent PR mot master, valideres og publiseres på nytt. Hvis metadata mangler etter en tidligere vellykket deployment, gjenopprettes den kjente metadatafilen fra siste fungerende Pages-artifact gjennom en kontrollert reparasjons-PR; den skal ikke nullstilles i stillhet. Ikke slett brukerdata. Start ny workflow fremfor å kjøre en gammel deploy-jobb på nytt med duplikate artifacts.

## Tilgang og hva som må rapporteres

GitHub-integrasjonen kan lese/skrive repo, branch og PR og lese tilgjengelige Actions-resultater. Den tilgjengelige integrasjonen har ingen ny workflow-dispatch eller full innstillingsadministrasjon. Hvis direkte CLI ikke virker, må testvalget kjøres via Actions-grensesnittet over. Direkte API/Pages-kontroll fra utviklingsmiljøet trenger fungerende proxy og tillatte verter `api.github.com` og `geirskoglund.github.io`; en tillatt vert alene beviser ikke autentisering eller Actions-rettighet. Bruk støttet miljøoppsett og bevar proxyen.

Hver levering oppgir faktisk kjørte kontroller, resultat, eksakt commit, PR og eventuelle konkrete blokkeringer. Lokal simulering er ikke en reell Actions-/Pages-deployment, og vellykket testdeploy beviser ikke produksjonspublisering etter merge. Fysisk app-test rapporteres separat. Historiske forsøk fra originalspesifikasjonen er heller ikke verifikasjon av denne appen.

## Sanggrunnlaget fra issue #4

Automatisert kravdekning (T01–T10 viser til issuen):

| Bevis | Krav / testforløp |
| --- | --- |
| `tests/chordpro.test.mjs`: UUID per innlesing, uendret BOM/CRLF/LF/ukjent innhold, opprinnelse, filnavnfallback | F01–F05, F10, F14; T01–T02 |
| Parserprøver: påkrevde direktiver, musikalsk rekkefølge, akkordsymboler/midt i ord/påfølgende akkorder, eldre markører, manglende/ufullstendig refreng, stabile forekomster | F15–F21, F23; T03–T04 |
| `songs.spec.mjs`: tre like titler/filer, ulike ID-er, trygg HTML-tekst, individuelle refreng og gjenåpning | F01–F05, F10–F12, F14–F16, F19–F21, F23; T01–T04 |
| Layout ved 320/768/1440 px, mørkt tema, 16/36 px, langt enkeltord, midtordakkorder og rene akkordlinjer; tekst/akkord-cellers geometri og viewportbredde | F17–F18, F22–F25, F28–F30; T05 |
| Tema/størrelse på tvers av sanger/omstart, OS-lyst med mørk standard og scroll øverst ved ny åpning | F26–F30; T06 |
| Full lukking av Chromium, ny prosess med samme vedvarende profil, offline før navigasjon, sang/refreng/innstillinger uendret | F06–F07, F11–F12, F20, F28–F29; T07 |
| `shell.spec.mjs`: faktiske sanger i begge miljøer, to ekte workeroppdateringer, ny PR/SHA, uendret ID/original/personlig tilstand og uvedkommende cache | F01, F03, F06–F09, F20, F28–F29; T08 |
| Tom/binær/ugyldig UTF-8/feil filtype, ekte transaksjonsabort for sang og refreng, avvist database og utilgjengelig localStorage, deretter vellykket ny innlesing | F10, F13–F14, F20, F28–F29; T09 |
| Refreng med Enter, semantiske navn/expanded, miljømerking, oppdatering og navigasjon | Deler av T10; fysisk berøring/manuell kontroll gjenstår |

Filvelgeren aksepterer `.cho`, `.chordpro`, `.chopro`, `.crd`, `.pro`, `.chord`, `.txt` uten krav om bestemt MIME-type. UTF-8-dekoding er streng; BOM beholdes i originalen. Ingen eldreformatkonvertering skjer automatisk. Referanser bruker nærmeste tidligere definerte refreng.

Kort manuelt forløp på testutgaven:

1. Les inn to ChordPro-filer med samme tittel og samme fil en gang til. Åpne alle tre separat, prøv ren TXT og feil fil. Ved gjentatt filnavn prøves Avbryt og Importer i kopidialogen, også med endret innhold. Kontroller forståelig status og uendret oversikt etter feil.
2. Prøv kommentarer, lange linjer/ord, midtordakkorder og rene akkordlinjer. Første refreng er helt; åpne bare én senere henvisning. Bytt sang og åpne på nytt.
3. Bruk tastatur/berøring for filvalg, sangvalg, tilbake, refreng, Innstillinger og skriftstørrelse. Kontroller fokus og lesbarhet i mørkt tema ved 16–36 px. Les langt ned, åpne sangen igjen og kontroller at den starter øverst.
4. Vent på offline-klar, lukk nettleser/installert PWA helt, koble fra nettet og gjenåpne. Åpne sangen fra oversikten; kontroller refreng og globale valg.
5. Gjenta på fysisk iPad/Safari/installert PWA og en annen plattform. Etter neste testoppdatering kontrolleres at sanger og valg består. Produksjon og test skal ha egne data.

Fysisk iPad/Safari, installert PWA og fysisk berøring er **ikke utført** av Codex. Chromium ved nettbrettbredde er kun automatisert layoutbevis. Konkret SHA, nettleserversjon, kommandoresultater og publiseringsbevis oppgis i implementerings-PR-en, uten å forveksle det med produktgodkjenning.

## Android: nedtrekk ved øvre scrollgrense

`touch-scroll.spec.mjs` bruker Chromium med Android-/berøringsemulering i begge miljøer. Den kontrollerer at den faktiske scrollroten har vertikal overscrolling av, at nedtrekk øverst beholder dokument/sang/refrengtilstand, og at vanlig berøringsscroll, meny, refreng og tilbake fortsatt virker. Lagret sang/original endres ikke. Emulering kontrollerer appens scrollregel og gesthåndtering; den er ikke bevis for den fysiske Android-nettleserens native oppdateringsindikator.

Manuelt på fysisk Android/Chrome og installert PWA: åpne en lang sang, scroll opp til toppen og dra videre ned flere ganger. Sangen skal forbli åpen uten sideoppdatering. Prøv deretter normal scrolling begge veier, zoom, refreng, meny og tilbake. Bevisst appoppdatering skal fortsatt fungere. Fysisk Android-kontroll er ikke utført av Codex.

## Oppdateringskontroll

Oppdateringsflyten prøver også gjenoppretting av hele appvisningen: samme sang valgt via stabil ID selv ved like titler, åpne refreng, frigjort sticky-skjema, lesested etter endret ombrekking, oversiktens scroll og åpen meny med egen scrollposisjon. To faner beholder ulike sanger og posisjoner både ved aktivering og ved omlastingsvalget i den andre fanen. Øyeblikksbildet brukes bare én gang; vanlig sideomlasting går fortsatt til oversikten. Simulert utilgjengelig `history.replaceState` skal fortsatt tillate oppdatering uten tap av sangdata.

Ved førstegangsinnføring kan ikke en eldre, allerede kjørende versjon ta vare på visningstilstand den ikke har kode for å lagre. Installer derfor denne funksjonen først; bevaring kan så prøves ved neste reelle versjonsbytte. De automatiserte testene bygger begge sider av en reell workeroppdatering med funksjonen på plass. Fysisk Android-/Safari-/PWA-test av bevaring gjenstår.

`tests/e2e/updates.spec.mjs` bruker ekte genererte workere og miljøbygg. Første appbesøk uten omlasting skal kunne oppdateres helt til ny synlig SHA. En lang leseøkt får et synlig varsel ved minuttkontroll (nettleserens sidetid akselereres; workerinstallasjonen er reell), uten automatisk navigasjon eller datatap. Fokus og faktisk offline/online-overgang gir ny kontroll. En ventende oppdatering oppdages i en ny fane, og aktivering der gir den gamle fanen et eksplisitt omlastingsvalg. Bevaring av sangdata gjennom oppdateringen kontrolleres også. En repakket worker med samme SHA/PR skal verken gi varsel mens den venter eller når den overtar. Fersk HTML på siste versjon prøves med en eldre controller ved hjelp av Chromium-nettverksbypass, deretter reell workerovertakelse: fortsatt ingen oppdateringsbeskjed. Etter en ekte oppdatering skal ny kontroll gi «Du har siste tilgjengelige versjon». Manuelt trykk under en pågående automatisk kontroll skal få resultatet fra denne kontrollen, og senere automatiske kontroller skal bevare resultatteksten.

Manuelt: la appen stå åpen gjennom publisering av en ny testutgave, både rett etter første besøk og etter lengre lesing. Kontroller varsel, aktivering og ny SHA uten ekstra omlasting. Prøv hjemskjerm-PWA ved retur fra bakgrunnen og nettilbakekomst. Fysisk iPad/Safari-verifikasjon rapporteres separat.

## F31–F34: skjema, dynamikk og kompakt sangvisning

`tests/chordpro.test.mjs` prøver takter/slag, marginer, repetisjon/volta, flercelleakkorder, form/etikett, ugyldige nivåer og ufullstendige/nestede markører. Originaltekst med BOM/CRLF bevares. Valg av personlig skjema før felles, ingen ved fravær og ingen duplisering fra refrenghenvisninger har en deterministisk domeneprøve.

`tests/e2e/arrangement.spec.mjs` prøver én kompakt skjemaflate, fravær av generisk overskrift og inline-duplikater, sticky plassering under toppen, høydebegrensning ved vindusendring og pin-knappen som veksler sticky av/på: samme scrollposisjon ved frigjøring, synlig og betjenbar pin-off, gjenfesting med aktiv pin-on, beholdt tastaturfokus og minst 44 px treffområde. Innholdet finnes på originalplassen ved oppscrolling, og neste sangåpning har sticky på. Oppdateringstestene prøver både frigjort og gjenfestet tilstand gjennom en ekte workeroppdatering. Personlig prioritet prøves med en faktisk separat `personal`-oppføring i IndexedDB; samme UI brukes, og personlig innhold består gjennom lagring av refrengtilstand/ny åpning. Original/ID bevares. Ingen editor kreves for dette lagringsbeviset.

Profilen prøves som én sammenhengende SVG-sti med fast venstrekant, myke høyreoverganger, nøyaktige bredder 5/10/15/20/25 px og 30 px marg nedenfor tittel/skjema. Nivå 3 før første tagg, uavhengighet av tekststørrelse og manglende speiling kontrolleres geometrisk. Uten gyldige tagger, ved global av og ved 319 px er profil/marg borte; ved 320 px er de tilbake. Høyden oppdateres ved refrengfolding. Meny med Escape, fokus, vedvarende valg og offline gjenåpning inngår. Layout/geometri prøves ved 320/768/1440 px, 16/36 px og mørkt tema. Henvisningens overskriftsfarge sammenlignes med første refreng før trykk. Kontroller visuelt at samme smale venstrelinje følger refrengteksten i første og åpne henvisninger, og at linjen ikke vises for en sammenfoldet henvisning. Eksisterende lagrings-/oppdateringsprøver bruker menyen for de flyttede kontrollene; automatiske varsler prøves fortsatt under lesing uten meny.

Samme testfil kontrollerer faktiske avstander mellom synlige innholdselementer med lange blanklinjer, kommentarer, flyttet grid og åpne/lukkede refreng. Blanklinjeserier gir en halv tekstlinje ekstra avstand ved 320/768/1440 px og skrift 16/36 px. Reell høyde for ordinære tekstlinjer er høyst 1,2 ganger skriftstørrelsen; korte akkordlinjer og refrengkontroll må også holde seg innenfor kompakte høydegrenser. Kommentar → fullt refreng, kommentar → refrenghenvisning og kommentar → tekst uten blanklinje i kilden har null ekstra layoutavstand, både med åpen og lukket henvisning. Lagret original med BOM/CRLF og alle blanklinjer er fortsatt identisk.

`songs.spec.mjs` kontrollerer at toneartspillen bare viser verdien, med tilgjengelig navn «Toneart: …», og at sanger uten toneart viser standard takt 4/4 uten en tom toneartspille.

Manuelt: les inn [prøvefilen](../examples/akkordskjema-og-dynamikk.cho). Kontroller kompakt topp og samlet skjema, scroll og se at det fester seg. Trykk aktiv pin mens skjemaet er sticky, scroll opp og finn det på originalplassen. Den dempede pinnen skal fortsatt vises; trykk den for å feste skjemaet igjen, og kontroller at aktiv pin kommer tilbake. Åpne sangen igjen og kontroller at sticky er på igjen. Kontroller at den sammenhengende profilen ligger tydelig nær tekstfargen i mørkt tema, trykk direkte på «Refreng», og bruk Innstillinger for skrift/av-på og appstatus. Kontroller at menyen kan lukkes uten å miste lesestedet. På fysisk iPhone/iPad/Safari gjenstår kontroll av profilform, berøring, sticky høyde og offline etter oppdatering.

## Sangredigering, Råtekst og persondata (#30)

Domenetestene i `source-edit.test.mjs`, `original.test.mjs`, `annotations.test.mjs` og `personal.test.mjs` kontrollerer presise kildehandlinger, BOM/blandede linjeskift, råtekstnormalisering, aliaser/ukjent syntaks, første toneart/samlet transponering, gruppert historikk over lagring, forkastet råtekst, refrengforekomster og annoteringsbevaring.

Nettleserkontrollene følger den nye arbeidsflyten i stedet for den fjernede formaterte modalens OK/underliggende Lagre:

- `editor.spec.mjs`: moduser, lesested/historikk, autosparing, Opprett/Avbryt/Lagre, capo i begge kilder, felles/personlig skjema, F05, valgt element/Fjern og viewportgrenser 320/768/1440.
- `original.spec.mjs`: ekte transaksjonsabort over begge lag, retry uten dublett, videre arbeid under en holdt transaksjon, andre faners uberørte personfelt, nyere original, eksakt kildebevaring, bokstavelig raw-key og faktisk workeroppdatering/offline.
- `personal.spec.mjs`: numeriske grenser og ett angresteg, flere skjemaer/form/etiketter/fallback, ugyldige/skjemautkast, uavhengige faner og lesested/pin/refreng ved modusbytte.
- `annotations.spec.mjs`: forkortet/tom original og fortsatt redigerbare notater, sikre/usikre markeringer, angre av originalendring, legacy-rensing og filkopi uten overskriving.
- `editor-feedback.spec.mjs`: refrenggrenser/endehåndtak, henvisning/dynamikk/anvisning, notatdrag og kompakte grid/tomme celler.
- `app-interactions.spec.mjs`: global kontekstpolicy, verktøy-først-utvalg over flere linjer, Fjern, appvalidering og fravær av nye clipboard-tillatelser.
- `review-feedback.spec.mjs`: tittelaliaser, fri takt, lukking ved feil, forankrede énlinjefelt, stemming uten nytegning, tittelmal/[], F05 uten tekstforskyvning, levende forankring, plassering ved filslutt, hele ord, long press/Fjern, capo-riktig akkorddrag og refrengdynamikk/foldestatus.
- `placement-feedback.spec.mjs`: dempet/vannrett F05 ved teksthøyde på akkordlinjer, samsvar mellom flytteforhåndsvisning og slipp, gyldige mål ved refrengoverskrifter, avvist overlapp uten notattap, frittstående Refreng uten merknad, kompakt luft ved filslutt og større touch-akkord med tekstkontekst og presis markør.
- `dialog-touch.spec.mjs`: gjentatte taggtrykk uten blur/fokusbrudd, bevart markør, avbrutt touch, redusert viewport, keyboard-retur og numerisk aktivering først ved slipp.

Regresjonsgrunnlaget for sangliste/sangbøker, setlister, arrangementsvisning, berøringsscroll, appskall, faktiske workere og miljøisolasjon beholdes. Påstander om Lagre-knappen, forhåndsvalg før verktøy og permanente slettekryss er erstattet med #30s nye funksjon, mens lagrings-/databevaringskontrollene består. Testkode alene er ikke resultatbevis; faktiske kjøringer, nettleserversjon og SHA rapporteres i leveranse-PR-en.

Manuelt på fast testutgave: Opprett → sangbokvalg/Fortsett → Råtekst → skriv tittel/tekst → taggknapper → Lagre → fortsett redigering. Prøv første Avbryt, senere raw-Avbryt, ett Angre per verdikontroll, Gjør om og faner/moduser. Prøv akkorder midt i ord, long press/valg/drag/Fjern, avbrudd og ett angresteg; kontroller den større forhåndsvisningen over fingeren. Prøv dynamikk inne i egen refrengblokk, sammenfoldede henvisninger i Rediger, gjenopprettet åpning i Visning og uavhengig nivå før en henvisning. Prøv «Rett etter»/«Med luft» ved sangslutt, Enter/Shift+Enter og eksisterende blanklinje. En frittstående {chorus} skal bare vise Refreng. Prøv fritekst i takt, dupliserte t/title-tagger og lukking ved feil. Prøv felles/personlig skjema og capo samt samlet toneartsendring. Kontroller F05 ved tom linje, tekst med akkorder og tettstående notater, stabilt slipp ved refrengoverskrift, flerlinjegulmarkering, innstillinger/lesested, feil/retry og offline. Ingen ekstern fil skal publiseres automatisk.

Fysisk iPad/Safari, Android/Chrome og installert PWA må spesielt kontrollere skjermtastaturet under gjentatte taggtrykk, beholdt feltfokus/markør, markør inne i verdifelt, berøringsutvalg/drag, safe-area, orientering og redusert viewport. Syntetisk blur-teller, emulert touch og Chromium er tekniske bevis, ikke fysisk OS-/nettleserbevis.

## Designsystem og appskall (#23)

`design-system.spec.mjs` prøver alle hovedsider ved 320/768/1440 px, sidepanel under faktisk header, operativ hamburger, Escape/fokus, tidligere lysinnstilling, innstillingsbesøk med bevart autospart sangøkt og vanlig sidebytte, endret headerhøyde, lokale offlinefonter og oppgradering av gammel innstillingsdialogtilstand. Øvrige integrasjonstester bruker plussmenyens Opprett og sangheaderens Rediger og egen Innstillinger-side. De beholder utkast-, lagrings-, original-, geometri- og oppdateringskontroller; lysmodus er ikke lenger en produktvariant.

`design-contracts.spec.mjs` gir et avgrenset vern mot drift fra [målreglene](DESIGN.md#målregler-for-komponenter-i-bruk): D02-navnefelt, E02/E03/E04-footer og ramme, E01s rette hjørner, H04s farger/geometri, D09/D10-felt og D10-separator samt L02-rader ved 320/768/1440 px. Beregnede stiler og DOM-mål sammenlignes med designreferansene, uten å hente forventede verdier fra CSS-implementeringen. Det prøves også lange navn og redusert høyde. En liten testfixture bygger de faktiske kontrollfunksjonene for footer-varianter som ennå ikke brukes i en produktflyt; den er bare tilgjengelig fra lokal testserver og inngår ikke i appbyggene. Eksisterende forløpstester prøver faktisk dialogbetjening. Dette er noen sentrale kontroller, ikke en forhåndsimplementering eller full automatisering av komponentkatalogen. Skjermbildebaseliner innføres først mot en kontrollert og produktgodkjent fasit; automatisk baselineoppdatering er ikke designgodkjenning.

Hver UI-leveranse skal ha en kort, nummerert egensjekk i PR-en. For hver berørt komponent/variant oppgis stabil ID, normativ referanse, relevante tilstander og bredder, faktisk måling/visuell sammenligning og resultat. Kontroller fargeroller, font, marger/padding, radier, rammer, ikoner og sammensetning samt betjening. Skill dokumentert samsvar, nye/arvede avvik og uverifiserte forhold. Gjenbrukte kontroller kontrolleres også. Kontrollen gjøres mot vedtatt design; issueskisser er illustrasjoner når de avviker. Rettelser og testforventninger skal vise til samme normative regel, og avvik løftes før levering fremfor å skjules ved å godkjenne dagens rendering som ny fasit.

Manuelt på testadressen: sammenlign farger/fonter, meny, Innstillinger uten temavelger og dialogfootere mot designreferansene. Prøv lange handlingsetiketter, store skrifter og safe-area/skjermtastatur på fysisk iPad/Safari og Android/Chrome. Verifiser også installert PWA/offline. Automatisert Chromium beviser ikke disse fysiske forholdene. Faktisk SHA, CI-resultat og gjenværende fysiske kontroller rapporteres i PR.

## Avgrensning av kontrollarbeid

Lokalt velges relevante tester, for eksempel `node --test tests/pages-plan.test.mjs tests/github-pages.test.mjs tests/pages-artifacts.test.mjs` ved endring av publiseringsoppsettet. I miljøer med begrenset prosessisolasjon kan `--experimental-test-isolation=none` kjøre de samme Node-testene i én prosess. TypeScript eller målrettet Playwright og visuell kontroll kjøres når endringen berører dem. Hele nettlesersuiten trenger ikke kjøres både lokalt og i CI ved hver liten rettelse. CI gir det komplette regresjonsbeviset.

Etter publisering kontrolleres forventet SHA og tilgjengelighet, og berørt funksjon prøves kort. Brede ekstra skript for uendrede funksjoner brukes bare ved konkret regresjonsrisiko. Plattformkrav og fysiske tester beholdes der de er relevante.

Gjenbruk, identitet, korrupte/manglende filer og eldre kilder har kontrakttester; PR-CI kontrollerer artifactproduksjonen. Den aktive publiseringsflytens faktiske master-/Pages-kjøringer og gjenbruk er dokumentert i [godkjent PR #10](https://github.com/geirskoglund/hobos-songbook/pull/10). Nye endringer i flyten må fortsatt kontrolleres mot faktisk master-/Pages-kjøring etter godkjent merge.

## Sangliste og sangbøker (#25 og #35)

`tests/e2e/song-list.spec.mjs` prøver oppgradering av faktiske v1-data til v2 med uendret ID/original/opprinnelse/persondata, transaksjonsabort med full tilbakerulling, gammel blokkert forbindelse og nytt forsøk. Den dekker Standard én gang, bevaring av eksisterende tilhørighet, Alle/én bok, alfabetiske valg, tom/ugyldig bok, autosparte og angrede metadata, capo uten kjent toneart, tastatur/fokus, faktisk systemfilvalg fra plussmenyen og smal/bred layout med lange navn. Offline gjenåpning og adskilte miljøer inngår. Eksisterende original-/person-/workerprøver bruker gjeldende databaseskjema og nye synlige innganger.

Manuelt på testutgaven: kontroller at gamle sanger ligger i Standard og at notater, capo, stemming og original er beholdt. Velg Alle/Standard, åpne en rad, rediger, prøv Angre/Gjør om, og gå tilbake. Prøv pluss → Opprett (sangbokvalg/Fortsett, Råtekst, Avbryt, Lagre) og pluss → Importer (sangbokvalg/Fortsett, filvalg, kopibekreftelse, avbrudd). Kontroller filter etter omstart/offline, hamburger, fokus, lange titler og siste rad over plussknappen. Flere sangbøker og lokal administrasjon prøves også i forløpene for #35 nedenfor. Fysisk iPad/Safari, Android/Chrome og installert PWA må fortsatt verifiseres separat. Faktiske resultater og SHA står i leveranse-PR-en.


`tests/songbook.test.mjs` prøver navne-/unikhetsregler, reserverte systemnavn, Unicode, eksplisitt mål og forslagsprioritet. `tests/e2e/songbooks.spec.mjs` supplerer migreringsprøvene med AK35-01–AK35-10: faktisk CRUD, stabil identitet og uendret original/persondata/setlister; atomisk overføring med abort midt i skriving og ved bokfjerning; retry og samtidige faner; D09/D10, én popup med kontekstuell ikonoverskrift/ett verdifelt, valgliste innenfor samme ramme over footeren ved 320/768/1440 px, tastaturåpning og Escape i to trinn, selvstendig ny bok og Avbryt; obligatorisk mål, øktforslag og bortfalt mål med bevart råtekst; foreldet tom-bokdialog og sist-bok-vern; korrekt filter ved sletting/persistensfeil; lange navn og 320/768/1440 px, offline/miljøisolasjon samt workeroppdatering med posisjon, meny, Innstillinger-retur og ulagret navn. Import-/editorprøvene bruker valgtrinnet og bevarer eksisterende filvalgs-, UTF-8-, kopi- og redigeringskontroller. Faktiske kjøringer og SHA rapporteres i leveranse-PR-en; testdekning er ikke i seg selv produktgodkjenning.

`tests/e2e/storage-compatibility.spec.mjs` prøver overgang fra den tidligere publiserte v4-testdatabasen til sangbokutgaven: uendret databaseversjon, original/BOM/CRLF, sang-/bok-ID-er, persondata, setlister, ekstra bok-/sangmetadata og sync-lager; lokal navneendring, sangredigering/import og offline gjenåpning. Ukjent nyere versjon og avvikende keyPath skal stoppe med korrekt forklaring og beholde alle poster også ved nytt forsøk. Dette supplerer v1/v2/v3-migrering og testes uten å slette nettleserdata.

Manuelt for #35 på fast testadresse: åpne Sangbøker, opprett og endre navn, kontroller alfabetisk rekkefølge/antall og åpne bokraden som filter. Prøv D10s Ny sangbok fra Opprett, Importer og Slett, og avbryt både navnedialogen og den videre flyten. Kontroller at Opprett i sangbok, Importer i sangbok og Slett sangbok har ikonet i headeren, ett verdifelt og en valgliste i samme popup uten ekstra Sangbok-header eller rammer oppå hverandre. Prøv tom/siste bok, overføring til eksisterende/ny bok og Avbryt med bevarte sanger/tilpasninger. Kontroller at bare vellykket sanglagring påvirker sist brukt, at målvalget ikke endrer filteret, og at Alle aldri er mål. Prøv tastatur/Escape/fokus, appens feltmeny, lange navn, offline, oppdatering og Innstillinger-retur. Fysisk iPad/Safari, Android/Chrome, systemfilvalg, skjermtastatur og installert PWA gjenstår som egne plattformkontroller; emulert bredde/Chromium erstatter dem ikke.
