# Kontroll og publisering

## Leveransegrense og kontroll

Kodebasen har PWA/offline, miljøisolasjon og CI/CD samt lokal sanglagring, ChordPro-innlesing og grunnleggende sangvisning fra issue #4. Fullverdig bibliotek, editor/konvertering og Dropbox er senere arbeid. Funksjons-PR-er trenger brukertest på fast testadresse og uttrykkelig mergegodkjenning.

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

## Brukertest av appskallet før merge

1. Åpne fast testadresse mens du er på nett. Kontroller «Testversjon», forventet PR og commit i bunnteksten mot PR-leveringen/`build-info.json`. Startsiden skal identifisere Hobo's Songbook, ha lesbar tekst og ingen fungerende sang-/setlistekontroller.
2. Vent på «Klart for bruk uten nett». Installer på hjemskjermen på iPad, åpne den installerte appen online og vent på samme status. Oppgi iPadOS-versjon, Safari/installert modus og commit. Chromium eller en simulert iPad-bredde er ikke fysisk iPad-bevis.
3. Lukk appen helt, slå på flymodus og åpne den installerte appen igjen. Navn, riktig testmiljø, tekst og oppdateringskontroll skal vises; «Uten nett» er forventet. Prøv også vanlig nettleser og en annen tilgjengelig plattform, og registrer OS/nettleser/installert modus separat.
4. Gå online igjen. Appen kontrollerer automatisk ved oppstart, fokus/synlighet, nettilbakekomst og hvert minutt mens den er synlig på nett. En ny versjon skal gi et fast varsel også langt nede i en sang og når appinformasjonen er lukket. «Se etter oppdatering» kontrollerer også manuelt. Når en ny testcommit er publisert, skal «Oppdater appen» ta i bruk den og vise ny commit. Ikke slett nettleserdata ved en eldre utgave; lukk/åpne mens du er på nett og bruk oppdateringskontrollen.
5. Meld konkret forløp, forventet/faktisk resultat, enhet/OS/nettleser/modus og PR/SHA. Rettelser gjøres i samme PR/testløp. Produktansvarlig gir uttrykkelig mergegodkjenning etter vurdering. Eventuelle uutførte fysiske kontroller skal oppgis, ikke kvitteres ut av CI.

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
| Layout ved 320/768/1440 px, begge temaer, 16/36 px, langt enkeltord, midtordakkorder og rene akkordlinjer; tekst/akkord-cellers geometri og viewportbredde | F17–F18, F22–F25, F28–F30; T05 |
| Tema/størrelse på tvers av sanger/omstart, OS-lyst med mørk standard og scroll øverst ved ny åpning | F26–F30; T06 |
| Full lukking av Chromium, ny prosess med samme vedvarende profil, offline før navigasjon, sang/refreng/innstillinger uendret | F06–F07, F11–F12, F20, F28–F29; T07 |
| `shell.spec.mjs`: faktiske sanger i begge miljøer, to ekte workeroppdateringer, ny PR/SHA, uendret ID/original/personlig tilstand og uvedkommende cache | F01, F03, F06–F09, F20, F28–F29; T08 |
| Tom/binær/ugyldig UTF-8/feil filtype, ekte transaksjonsabort for sang og refreng, avvist database og utilgjengelig localStorage, deretter vellykket ny innlesing | F10, F13–F14, F20, F28–F29; T09 |
| Refreng med Enter, semantiske navn/expanded, miljømerking, oppdatering og navigasjon | Deler av T10; fysisk berøring/manuell kontroll gjenstår |

Filvelgeren aksepterer `.cho`, `.chordpro`, `.chopro`, `.crd`, `.pro`, `.chord`, `.txt` uten krav om bestemt MIME-type. UTF-8-dekoding er streng; BOM beholdes i originalen. Ingen eldreformatkonvertering skjer automatisk. Referanser bruker nærmeste tidligere definerte refreng.

Kort manuelt forløp på testutgaven:

1. Les inn to ChordPro-filer med samme tittel og samme fil en gang til. Åpne alle tre separat, prøv ren TXT og feil fil. Kontroller forståelig status og uendret oversikt etter feil.
2. Prøv kommentarer, lange linjer/ord, midtordakkorder og rene akkordlinjer. Første refreng er helt; åpne bare én senere henvisning. Bytt sang og åpne på nytt.
3. Bruk tastatur/berøring for filvalg, sangvalg, tilbake, refreng, tema og skriftstørrelse. Kontroller fokus og lesbarhet i begge temaer ved 16–36 px. Les langt ned, åpne sangen igjen og kontroller at den starter øverst.
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

`tests/e2e/arrangement.spec.mjs` prøver én kompakt skjemaflate, fravær av generisk overskrift og inline-duplikater, sticky plassering under toppen, høydebegrensning ved vindusendring og × som bare frigjør sticky for aktuell åpning: samme scrollposisjon, innhold tilbake på originalplassen ved oppscrolling og sticky på ved neste åpning. Personlig prioritet prøves med en faktisk separat `personal`-oppføring i IndexedDB; samme UI brukes, og personlig innhold består gjennom lagring av refrengtilstand/ny åpning. Original/ID bevares. Ingen editor kreves for dette lagringsbeviset.

Profilen prøves som én sammenhengende SVG-sti med symmetri, avrundede overganger, fem bredder og smal maksimumsbredde. Høyden oppdateres ved refrengfolding. Meny med Escape, fokus, vedvarende valg og offline gjenåpning inngår. Layout/geometri prøves ved 320/768/1440 px, 16/36 px og begge temaer. Henvisningens overskriftsfarge sammenlignes med første refreng før trykk. Kontroller visuelt at samme smale venstrelinje følger refrengteksten i første og åpne henvisninger, og at linjen ikke vises for en sammenfoldet henvisning. Eksisterende lagrings-/oppdateringsprøver bruker menyen for de flyttede kontrollene; automatiske varsler prøves fortsatt under lesing uten meny.

Samme testfil kontrollerer faktiske avstander mellom synlige innholdselementer med lange blanklinjer, kommentarer, flyttet grid og åpne/lukkede refreng. Blanklinjeserier gir en halv tekstlinje ekstra avstand ved 320/768/1440 px og skrift 16/36 px. Reell høyde for ordinære tekstlinjer er høyst 1,2 ganger skriftstørrelsen; korte akkordlinjer og refrengkontroll må også holde seg innenfor kompakte høydegrenser. Kommentar → fullt refreng, kommentar → refrenghenvisning og kommentar → tekst uten blanklinje i kilden har null ekstra layoutavstand, både med åpen og lukket henvisning. Lagret original med BOM/CRLF og alle blanklinjer er fortsatt identisk.

`songs.spec.mjs` kontrollerer at toneartspillen bare viser verdien, med tilgjengelig navn «Toneart: …», og at sanger uten toneart ikke får noen tom metadatarad.

Manuelt: les inn [prøvefilen](../examples/akkordskjema-og-dynamikk.cho). Kontroller kompakt topp og samlet skjema, scroll og se at det fester seg. Trykk × mens skjemaet er sticky, scroll opp og finn det på originalplassen. Åpne sangen igjen og kontroller at sticky er på igjen. Følg den smale, sammenhengende profilen, trykk direkte på «Refreng», og bruk menyen for tema/skrift/av-på og appstatus. Kontroller at menyen kan lukkes uten å miste lesestedet. På fysisk iPhone/iPad/Safari gjenstår kontroll av profilform, berøring, sticky høyde og offline etter oppdatering.

## Avgrensning av kontrollarbeid

Lokalt velges relevante tester, for eksempel `node --test tests/pages-plan.test.mjs tests/github-pages.test.mjs tests/pages-artifacts.test.mjs` ved endring av publiseringsoppsettet. I miljøer med begrenset prosessisolasjon kan `--experimental-test-isolation=none` kjøre de samme Node-testene i én prosess. TypeScript eller målrettet Playwright og visuell kontroll kjøres når endringen berører dem. Hele nettlesersuiten trenger ikke kjøres både lokalt og i CI ved hver liten rettelse. CI gir det komplette regresjonsbeviset.

Etter publisering kontrolleres forventet SHA og tilgjengelighet, og berørt funksjon prøves kort. Brede ekstra skript for uendrede funksjoner brukes bare ved konkret regresjonsrisiko. Plattformkrav og fysiske tester beholdes der de er relevante.

Workflowendringen aktiveres først etter godkjent merge til master. Før dette prøves gjenbruk, identitet, korrupte/manglende filer og eldre kilder med kontrakttester; PR-CI prøver selve artifactproduksjonen. Faktisk Pages-kjøring med ny masterinfrastruktur må kontrolleres etter merge.
