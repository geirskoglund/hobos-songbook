# Agentinngang

- Svar på bokmål. Bruk aktuell GitHub-issue som oppgavegrunnlag; bevar brukerkrav og stabile ID-er.
- Produktansvarlig beslutter, tester og godkjenner. ChatGPT avklarer og skriver funksjonelle issues. Codex-klargjører leser repoet og supplerer aktuell issue, men endrer ikke repofiler, branches, commits eller PR-er. Codex-implementerer koder, tester, oppdaterer relevant dokumentasjon og leverer PR/testutgave etter uttrykkelig implementeringsbestilling.
- Første `---` i issuen skiller brukerkrav fra Codex-klargjøring. Hver issue skal være selvstendig. Diskusjon, klargjøring og godkjent tekst er ikke en kodebestilling.
- Arbeid på egen branch og lever PR mot `master`. Vent på produktansvarligs uttrykkelige mergegodkjenning. Grønn CI er teknisk validering, ikke produktgodkjenning.
- [Issue #1](https://github.com/geirskoglund/hobos-songbook/issues/1) avklarer et engangsoppsett med to PR-er: bootstrap for CI/CD først, deretter hoved-PR med full produktdokumentasjon og PWA-skall. Bootstrap får teknisk review/godkjenning før app-testmiljøet finnes. Ikke start hoved-PR-en før bootstrap er godkjent og merget.
- Funksjons-/UI-PR-er publiseres på fast testadresse før brukertest og mergegodkjenning. Tilbakemeldinger rettes i samme implementeringsløp og testutgave.
- Les [README](README.md) og relevant del av [TESTING](docs/TESTING.md) for CI/CD. Les aktuell produktdokumentasjon målrettet når den er etablert i hoved-PR-en; de fire originale, daterte issue-kommentarene er inntil da produktgrunnlaget.
- Oppdater bare berørt dokumentasjon i samme PR som funksjonsendringen. Beskriv gjeldende tilstand; skill vedtatt, planlagt, implementert og faktisk verifisert. Historikk hører til i issues/PR-er/Git.
- Produksjon: `/hobos-songbook/app/`. Test: `/hobos-songbook/test/`. Ingen testbranch, nye miljøadresser eller sletting av brukerdata ved publisering. Bare betrodd master-infrastruktur styrer Pages; kjør aldri PR-kode med deployrettigheter.
