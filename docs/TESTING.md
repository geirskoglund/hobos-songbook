# Kontroll og publisering

## Leveransegrense og kontroll

Bootstrap etablerer publiseringsinfrastrukturen for [issue #1](https://github.com/geirskoglund/hobos-songbook/issues/1). Første leveranse har to tydelige oppstartsplassholdere uten manifest, service worker eller påstått offline-støtte. Full PWA, produktkrav, beslutninger, arkitektur og design dokumenteres og prøves i hoved-PR-en. Bootstrap trenger teknisk review og uttrykkelig mergegodkjenning før hovedarbeidet begynner; hoved-PR-en trenger i tillegg brukertest på fast testadresse.

Node.js 24 LTS og låst npm-fil brukes lokalt og i Actions:

```sh
npm ci
npm run check
```

Kontrollen syntakssjekker JavaScript og kjører Node-tester. Testene prøver første oppsett, eksakt workflow-/repo-/hendelses-/SHA-bevis, ugyldige/stale PR-er, mastervalidering, bevart testcommit, metadatafeil, byggfeil, artifactkontroll, søskenstier og etterkontroll. En faktisk feilende npm-validering inngår i negativ test. Appartefaktene i testene er kontraktfixtures, ikke en levert app eller bevis for installasjon, service workers, lagringsisolasjon eller offline. Bootstrap kan kontrolleres helt uten npm-nedlastinger: `npm ci --offline`.

`Validate / validate` kjører automatisk på PR og master. Ved PR sjekkes PR-hodets SHA ut, ikke en midlertidig mergecommit. Hoved-PR-en utvider `npm run check` med typekontroll, reelle appbygg og nødvendige nettleser-/offline-tester.

## GitHub-oppsett

1. Standardbranch er `master`. Bootstrap og videre arbeid leveres via PR; merge krever produktansvarligs uttrykkelige godkjenning.
2. Settings → Actions → General: tillat de offisielle checkout, setup-node, github-script, artifact og Pages-actions som workflowene bruker. Behold minste standardrettighet. Ingen Dropbox-secret, frontend App secret eller personlig token kreves.
3. Settings → Pages → Source: **GitHub Actions**. Produktansvarlig opplyser at dette er satt. Bruk ett Pages-nettsted uten custom domain. Faktisk deployment og HTTPS kontrolleres først etter godkjent bootstrap-merge.
4. Environment `github-pages` må tillate workflow fra master. Eventuell ventende environment-godkjenning må håndteres før deploy kan fullføres. Ikke innfør en slik sperre som utilsiktet hindrer automatisk publisering etter godkjent merge.
5. Når første CI er kjørt: krev PR og den reelle kontrollen `Validate / validate` på master, og hindre force push/sletting. Velg den faktiske kontrollen GitHub viser; ikke krev produksjonsdeploy før merge eller en ekstra reviewer som ikke finnes. Eier kan ikke godkjenne egen PR med GitHubs reviewfunksjon; dokumentert produktgodkjenning før merge gjelder likevel.

## Første publisering og senere testvalg

Bare `pages.yml` publiserer. Workflowen må finnes på master før `workflow_dispatch` og den etablerte `workflow_run`-flyten kan brukes. Før bootstrap-merge finnes derfor ingen forventning om en app-testutgave. Etter godkjent merge og grønn Validate for eksakt master-commit publiseres plassholderne automatisk. En 404 for `deployment.json` godtas som første oppsett bare når GitHub ikke har noen tidligere vellykket `github-pages`-deployment. API-/nettverksfeil og senere manglende/ugyldige metadata stopper publisering.

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

Planlegging og deploy kjører bare script fra eksakt validert master. Produksjon får alltid master-SHA; PR-SHA kan bare bli test. Actions-bevis krever riktig `ci.yml`-workflow-ID/-sti, repo, kilderepo, hendelsestype, SHA, PR/base der relevant, og vellykket `validate`-jobb i nyeste aktuelle kjøring. En kontroll med et passende navn alene gir ingen tillatelse. Ved push til master venter Pages på vellykket Validate; det finnes ingen konkurrerende direkte push-deploy.

Bygg kjører i separate jobber med `contents: read`, uten Pages-/OIDC-skriverettigheter eller lagrede Git-credentials. Deploy-jobben kjører aldri PR-script eller npm fra appkilden. Den leser kun statiske byggartefakter med masterens validator, setter sammen `app/` og `test/` og publiserer ett Pages-artifact. Den serialiserte workflowen leser testvalget på nytt og kontrollerer master/PR-hode og valideringsstatus rett før deploy. Endring under bygg avviser planen; en ny kjøring må ta utgangspunkt i ny kilde.

Rootens versjonerte `deployment.json` lagrer repo, produksjons-/test-SHA, PR, byggtype og faste stier. Feil i eksisterende metadata stopper også et eksplisitt nytt valg. Publisering kjører ingen migrering eller sletting av lokal lagring. Når produksjonsappen først finnes, kan den ikke erstattes med oppstartsplassholder.

## Appbyggkontrakt for hoved-PR-en

Hoved-PR-en legger til `app-build.json` med `{"version":1}`. Dette er markøren for at kilden inneholder et reelt appbygg. `npm ci`, `npm run check` og `npm run build` må fungere på eksakt SHA. Byggmiljøet er:

| Variabel | Verdi |
| --- | --- |
| `APP_CHANNEL` | `production` eller `test` |
| `APP_SHA` | Full 40-tegns kilde-SHA |
| `APP_PR` | PR-nummer eller tom streng for master |
| `APP_KIND` | `app` |

`npm run build` skriver selvstendige filer til `dist/`. Valideringskommandoen må også kunne bygge/teste uten at deploymentvariablene er satt i vanlig PR-CI; bruk dokumenterte lokale standardverdier i hoved-PR-en. Ingen appkode eller videre produktbeslutning leveres av kontrakten her.

- `build-info.json`: `{"version":1,"channel":"test","sha":"FULL_SHA","pr":7,"kind":"app"}` (master har `pr:null`).
- `index.html` har `id="app"`, korrekt `<title>` og apple-touch-icon. Testinngangen har synlig «Testversjon». Den reelle appen må vise PR/master og commit også etter oppstart.
- `manifest.webmanifest` har navn/short_name `Hobo's Songbook` eller `Hobo's Songbook Test`, `display:"standalone"` og relative `id`, `start_url`, `scope` lik `"./"`. Disse løses til hver sin faste søskenadresse.
- PNG-ikoner omfatter 192×192 og maskable 512×512; `apple-touch-icon.png` er 180×180. Manifestets ikonstier er enkle lokale PNG-filnavn. `sw.js` og alle kjøretidsressurser er lokale. Symlenker og skjulte filer godtas ikke i app-artifactet.
- Miljøkonfigurasjonen i hoved-PR-en bruker stabile navn `hobos-songbook-production` og `hobos-songbook-test` for cache-/fremtidige lagringsnavn. Reelle service workers begrenses til egen sti, aldri `/hobos-songbook/`. Commit/PR er byggmetadata, ikke lagringsidentitet. Samme origin er ingen sikkerhetsgrense mot ondsinnet script.

Før hoved-PR-merge bygges `/app/` som masterens betrodde plassholder og bare `/test/` som PR-appen. Etter godkjent merge blir `/app/` master-appen, mens valgt eksakt testbygg beholdes. Begge reelle appbygg må senere prøves sammen med ekte workere, separate lagringsmarkører og offline-gjenåpning. Fysisk installasjon/offline på iPad og en annen tilgjengelig plattform rapporteres separat fra Chromium.

## Feil og gjenpublisering

Feil i plan, validering, bygg, artifactkontroll eller sammensetning stopper før deploy og lar eksisterende nettsted stå. Endret master/nytt PR-hode under bygg avviser den gamle planen. Start en ny workflow etter grønn validering, med eksplisitt testvalg ved behov.

Etter deploy sammenlignes metadata, begge adresser og byggidentitet over HTTPS. For reelle apper kontrolleres også manifest/scope, ikoner og worker. Etterkontroll har avgrensede forsøk ved CDN-forsinkelse. En feil **etter** deploy er en etterkontrollfeil; nettstedet er ikke automatisk rullet tilbake.

Ved feilende testapp velges `preview=master` eller en kjent fungerende, validert åpen PR på nytt. Gjenpublisering av bevart testcommit bruker `keep`. En feil i produksjon rettes/reverteres via godkjent PR mot master, valideres og publiseres på nytt. Hvis metadata mangler etter en tidligere vellykket deployment, gjenopprettes den kjente metadatafilen fra siste fungerende Pages-artifact gjennom en kontrollert reparasjons-PR; den skal ikke nullstilles i stillhet. Ikke slett brukerdata. Start ny workflow fremfor å kjøre en gammel deploy-jobb på nytt med duplikate artifacts.

## Tilgang og hva som må rapporteres

GitHub-integrasjonen kan lese/skrive repo, branch og PR og lese tilgjengelige Actions-resultater. Den tilgjengelige integrasjonen har ingen ny workflow-dispatch eller full innstillingsadministrasjon. Hvis direkte CLI ikke virker, må testvalget kjøres via Actions-grensesnittet over. Direkte API/Pages-kontroll fra utviklingsmiljøet trenger fungerende proxy og tillatte verter `api.github.com` og `geirskoglund.github.io`; en tillatt vert alene beviser ikke autentisering eller Actions-rettighet. Bruk støttet miljøoppsett og bevar proxyen.

Hver levering oppgir faktisk kjørte kontroller, resultat, eksakt commit, PR og eventuelle konkrete blokkeringer. Lokal simulering er ikke en reell Actions-/Pages-deployment. Før bootstrap-merge kan verken den privilegerte publiseringskjøringen, HTTPS eller automatisk testvalg erklæres verifisert. Fysisk app-test hører til hoved-PR-en.
