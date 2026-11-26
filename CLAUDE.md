# Hobo's Songbook

Offline-first sangbok-PWA (Vite + TypeScript, ren DOM uten rammeverk) med privat Dropbox-synk.
Produksjon: https://geirskoglund.github.io/hobos-songbook/app/ · Test: https://geirskoglund.github.io/hobos-songbook/test/

> **Her står:** instruksjoner som gjelder nesten hver oppgave, og som agenten ville gjort feil uten. Korte linjer som viser videre i stedet for å forklare. Filen skal holde seg under 4 KB.
>
> **Ikke her:** produktregler, begreper, forklaringer eller noe som står i et annet dokument.

## Arbeidsform

- Svar på bokmål.
- Aktuell GitHub-issue er oppgavegrunnlaget. Bevar brukerkrav og stabile ID-er (krav, beslutninger D01–D24, komponent-ID-er som L05 og D10).
- Merge bare etter produktansvarligs uttrykkelige godkjenning; grønn CI er ikke produktgodkjenning.
- Lukk ferdigløste issues etter merge hvis automatisk lukking uteblir. Delvis løste issues holdes åpne.

## Kommandoer

- `npm run dev`: utviklingsserver
- `npm run format`: formater koden med Prettier. CI feiler på uformatert kode; Claude Code-hooken formaterer filer du endrer.
- `npm run lint`: ESLint og stylelint, bare regler som fanger feil. Nye regler slås på i en PR som retter alle bruddene; ingen `eslint-disable` på fil- eller mappenivå.
- `npm run typecheck`: typesjekk med TypeScript 7. Pakken `typescript` er 6.0 fordi typescript-eslint trenger den.
- `npm test`: enhetstester (raske)
- `npx playwright test tests/e2e/<fil>.spec.mjs`: én e2e-fil. Hele suiten (`npm run test:e2e`) tar ca. 8 min; kjør den bare ved brede endringer, CI kjører den uansett.
- `npm run check:quick`: kontrollen før PR
- `npm run check`: full validering, som i CI
- En ny worktree trenger `npm ci` først.

## Design og UI

- Designsystemet er bindende: komponentene i `docs/DESIGN.md` (ID, navn, SVG) og fargene i `src/theme.css`. Gjenbruk eksisterende kontroller; nye kontrolltyper krever produktavklaring.
- Les `docs/DESIGN.md` før UI-arbeid.
- Skisser i issues er illustrasjoner og endrer ikke vedtatt design.

## Publisering

- `/app/` bygges alltid fra `master`. `/test/` viser en valgt PR eller master.
- Funksjons- og UI-PR-er publiseres på testadressen før brukertest: `gh workflow run pages.yml --ref master -f preview=<PR-nummer>`. Tilbake til `master`: `-f preview=master`. Publisert commit står under `preview` i `https://geirskoglund.github.io/hobos-songbook/deployment.json`.
- Kjør aldri PR-kode med deployrettigheter. Slett aldri brukerdata ved publisering.

## Dokumentasjon

Produktsannheten står i `docs/REQUIREMENTS.md`, `docs/DECISIONS.md`, `docs/DESIGN.md` og `docs/ARCHITECTURE.md`. Les målrettet; dokumentene er store og skal ryddes. Oppdater dem bare når en produktregel endres, og bare ett sted. Historikk hører hjemme i git og issues, ikke i dokumentene.

Hvert dokument har opptakskrav øverst. Legg bare inn innhold som oppfyller kravet i det dokumentet. Begreper defineres bare i `GLOSSARY.md`, og vedtatte definisjoner endres ikke uten produktavklaring.

## Agent skills

### Issue tracker

Issues spores i GitHub Issues (geirskoglund/hobos-songbook) via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Standard vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context; beslutninger i `docs/DECISIONS.md`, ikke `docs/adr/`. See `docs/agents/domain.md`.
