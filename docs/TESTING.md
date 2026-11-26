# Test og publisering

> **Her står:** kommandoer, CI, publisering, valg av testutgave og manuell kontroll på fysiske enheter.
>
> **Ikke her:** beskrivelser av enkelttester eller testfiler, eller produktregler.

## Kommandoer

Bruk Node.js 24 LTS.

```sh
npm ci
npx playwright install chromium
npm run check        # alt, som i CI
npm run check:quick  # formatering, lint, typesjekk, ubrukt kode (knip), syntaks og enhetstester
npm run lint         # ESLint (eslint.config.mjs) og stylelint for farger (stylelint.config.mjs)
npm test             # bare enhetstestene (tests/*.test.mjs)
npm run test:e2e     # bygger begge kanaler og kjører Playwright (tests/e2e/)
npx playwright test tests/e2e/<fil>.spec.mjs
```

E2E-testene kjører mot ekte produksjonsbygg av `/app/` og `/test/` på samme origin, med ekte service workers. Dropbox erstattes av en HTTP-simulator. `CHROMIUM_PATH` kan peke på en nettleser som allerede er installert.

## CI og publisering

To valideringer kjører samtidig på hver PR og hver push til `master`:

| Kontroll | Workflow | Innhold | Kreves for |
| --- | --- | --- | --- |
| `Validate / validate` | `ci.yml` | `npm run check:quick` og bygg av kanalene | Merge, test og produksjon |
| `E2E / e2e` | `e2e.yml` | `npm run test:e2e` | Merge og produksjon |

- **Test** (`/test/`) publiseres når Validate er grønn for eksakt PR-hode, uten å vente på E2E. En PR med rød E2E kan altså vises på test, men ikke merges.
- **Produksjon** (`/app/`) publiseres bare fra en master-commit der både Validate og E2E er grønne.
- **Bare dokumentasjon:** En PR som bare endrer `docs/**` og `*.md` (`scripts/change-scope.mjs`), får grønne kontroller uten installasjon, tester og bygg. Den kan ikke publiseres til test, og en slik merge publiserer ikke produksjon på nytt. Master valideres alltid fullt.
- **Sikkerhet:** Bare `pages.yml` publiserer. Den kjører bare skript fra validert master, og jobben med deployrettigheter kjører aldri PR-kode eller npm fra appkilden. Den henter ferdige bygg og setter sammen `app/` og `test/` til ett Pages-nettsted.
- Publisering sletter eller migrerer aldri lokal lagring.

### Referansebilder

Skjermbildetestene (`tests/e2e/visual.spec.mjs`) sammenligner med referansebilder i `tests/e2e/visual.spec.mjs-snapshots/`. Bildene lages og sammenlignes bare på Linux, som i CI. Feiler E2E, laster jobben opp artefakten `referansebilder` med nye bilder for endrede og manglende skjermbilder. Er endringen tilsiktet, legges bildene inn i PR-en:

```sh
gh run download <run-id> -n referansebilder -D tests/e2e/visual.spec.mjs-snapshots
```

Endrede referansebilder vises i PR-diffen.

## Velge testutgave

`/test/` viser én valgt PR eller en fast master-commit. Nye grønne commits i valgt PR følger automatisk.

```sh
gh workflow run pages.yml --ref master -f preview=<PR-nummer>
```

| `preview` | Virkning |
| --- | --- |
| `<PR-nummer>` | Velger åpen PR mot `master` og publiserer gjeldende validerte hode |
| `keep` | Beholder publisert test-commit, også etter merge eller slettet gren |
| `master` | Viser samme commit som produksjon. Følger ikke nye master-commits |

Før en testutgave meldes klar: kontroller at Pages-kjøringen er grønn, og at PR og commit i appens meny stemmer. Rotens `deployment.json` og hver kanals `build-info.json` viser det samme.

## Bygg

`npm run build` skriver til `dist/`. Uten variabler bygges test fra gjeldende Git-HEAD. CI setter dem eksplisitt:

| Variabel | Verdi |
| --- | --- |
| `APP_CHANNEL` | `production` eller `test` |
| `APP_SHA` | Full kilde-SHA |
| `APP_PR` | PR-nummer, tom for master. Produksjon avviser PR-nummer |
| `APP_KIND` | `app` |

`npm run dev` serverer test på `http://localhost:5173/hobos-songbook/test/` uten service worker. Offline og oppdatering kan bare prøves med produksjonsbygg, i e2e eller på testadressen.

## Feil og gjenpublisering

- Feil før deploy stopper publiseringen og lar nettstedet stå uendret. Start en ny kjøring etter grønn validering.
- Feil i testutgaven: velg `preview=master` eller en annen fungerende PR.
- Feil i produksjon rettes eller reverteres med en PR mot `master`.
- Ugyldig eller manglende `deployment.json` stopper publiseringen. Den gjenopprettes fra siste fungerende Pages-artifact via en PR, aldri ved å nullstille den.

## GitHub-oppsett

- Pages-kilde: GitHub Actions, uten eget domene. Environment `github-pages` tillater workflow fra `master`.
- Regelsett på `master`: krev PR og kontrollene `Validate / validate` og `E2E / e2e`, og hindre force push og sletting.
- Ingen hemmeligheter trengs. Dropbox-appene bruker PKCE uten app secret.

## Manuell kontroll på fysiske enheter

Automatiske tester kjører i Chromium mot en Dropbox-simulator. Følgende må prøves på testadressen, på fysisk iPad/Safari og Android/Chrome, både i nettleser og som installert PWA, når en endring berører det:

1. **Offline:** Vent på «Klart for bruk uten nett», lukk appen helt, slå på flymodus og åpne igjen. Sanger og innstillinger skal være der.
2. **Oppdatering:** La appen stå åpen mens en ny testutgave publiseres. Varselet skal komme, og «Oppdater appen» skal vise ny commit med samme skjerm og lesested. Slett aldri nettleserdata for å få en oppdatering.
3. **Berøring og tastatur:** Long press, dra akkorder og notater, skjermtastatur under Råtekst og taggknapper, safe-area, orientering og 320 px bredde. Nedtrekk øverst i en sang skal ikke laste siden på nytt på Android.
4. **Dropbox, med egne prøvedata:** Koble til, synkroniser begge veier mellom to enheter, prøv konflikt, offline og avbrudd. Frakobling skal beholde lokale data.
5. **Deling:** En mottaker av delingslenken skal kunne lese bokens Shared-mappe, men ikke Private, Import, Originals eller `.app/`. En avpublisert sang skal forsvinne fra lenken.

Test og produksjon har hver sin lagring og hver sin Dropbox-app, så prøvedata på test berører ikke produksjon.
