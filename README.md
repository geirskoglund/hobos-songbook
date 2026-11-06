# Hobo's Songbook

Offline-first sangbok som PWA for nettbrett, mobil og PC/Mac.

Prosjektet etableres gjennom [issue #1](https://github.com/geirskoglund/hobos-songbook/issues/1). Denne bootstrap-leveransen inneholder CI/CD, testet publiseringslogikk og oppstartsplassholdere. Appskallet, PWA/offline-funksjonen og full strukturert produktdokumentasjon leveres i en egen hoved-PR etter at bootstrap er godkjent og merget. Sangfunksjoner og Dropbox er ikke implementert.

- [Agentinstruksjoner](AGENTS.md)
- [Kontroll, publisering og oppsett](docs/TESTING.md)
- Produksjonsadresse: https://geirskoglund.github.io/hobos-songbook/app/
- Testadresse: https://geirskoglund.github.io/hobos-songbook/test/

Adresser er publiseringsmål, ikke en bekreftelse på at første deploy er utført. Bootstrap-plassholderne er ikke installérbare eller offline-klare apper.

Bruk Node.js 24 LTS. Bootstrap har ingen npm-avhengigheter:

```sh
npm ci
npm run check
```

`Validate / validate` kontrollerer PR-ens eksakte kildecommit og pushes til master. Deploy starter etter grønn validering eller et eksplisitt, kontrollert manuelt valg. En godkjent master-merge publiserer produksjon og beholder valgt testcommit. PR-en skal godkjennes uttrykkelig før merge.
