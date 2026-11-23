# Hobo's Songbook

Offline-first sangbok-PWA (Vite + TypeScript, ren DOM uten rammeverk) med privat Dropbox-synk.
Produksjon: https://geirskoglund.github.io/hobos-songbook/app/ · Test: https://geirskoglund.github.io/hobos-songbook/test/

## Arbeidsform

- Svar på bokmål.
- Aktuell GitHub-issue er oppgavegrunnlaget. Bevar brukerkrav og stabile ID-er (krav, beslutninger D01–D16, komponent-ID-er som L05 og D10).
- Arbeid på egen gren og lever PR mot `master` med `Closes #N`. Merge bare etter produktansvarligs uttrykkelige godkjenning; grønn CI er ikke produktgodkjenning.
- Lukk ferdigløste issues etter merge hvis automatisk lukking uteblir. Delvis løste issues holdes åpne.

## Kommandoer

- `npm run dev`: utviklingsserver
- `npm run typecheck`: typesjekk
- `npm test`: enhetstester (raske)
- `npx playwright test tests/e2e/<fil>.spec.mjs`: én e2e-fil. Hele suiten (`npm run test:e2e`) tar ca. 8 min; kjør den bare ved brede endringer, CI kjører den uansett.
- `npm run check`: full validering, som i CI

På Windows feiler 6 tester som består i CI (npm uten shell, symlenker, utklippstavle). De er kjente og skyldes ikke endringen din.

## Design og UI

- Designsystemet er bindende: komponentene i `docs/design/README.md` (ID, navn, SVG) og fargene i `src/theme.css`. Gjenbruk eksisterende kontroller; nye kontrolltyper krever produktavklaring.
- Skisser i issues er illustrasjoner og endrer ikke vedtatt design.
- Ingen gule/gylne fokus-, aktiv- eller hoverrammer. Bruk den felles, dempede tastaturmarkeringen.
- Appen eier tekst- og kontekstbetjening: unngå nettleserens kontekstmenyer, native verktøytips og valideringsballonger.

## Publisering

- `/app/` bygges alltid fra `master`. `/test/` viser en valgt PR eller master.
- Funksjons- og UI-PR-er publiseres på testadressen før brukertest.
- Kjør aldri PR-kode med deployrettigheter. Slett aldri brukerdata ved publisering.

## Dokumentasjon

Produktsannheten står i `docs/REQUIREMENTS.md`, `docs/DECISIONS.md`, `docs/DESIGN.md` og `docs/ARCHITECTURE.md`. Les målrettet; dokumentene er store og skal ryddes. Oppdater dem bare når en produktregel endres, og bare ett sted. Historikk hører hjemme i git og issues, ikke i dokumentene.

## Agent skills

### Issue tracker

Issues spores i GitHub Issues (geirskoglund/hobos-songbook) via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Standard vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context; beslutninger i `docs/DECISIONS.md`, ikke `docs/adr/`. See `docs/agents/domain.md`.
