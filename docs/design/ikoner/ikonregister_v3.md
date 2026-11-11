# Hobo’s Songbook – ikonregister v3

Visuell arbeidsretning: Organisk. Oppdatert etter brukerens kommentarer til ark 01, 02 og 03 samt siste avklaringer.

## Prinsipper og beslutninger

- Ett ikon per funksjonelt konsept, gjenbrukt uansett skjerm. Ikke et krav om at ethvert konsept har en egen permanent knapp.
- Felles/originalt innhold er sangdata fra originalfilen (eventuelt endret i privat arbeidskopi), ikke en påstand om at data er publisert eller endret i Dropbox.
- Samme akkordskjemaikon brukes for personlig og originalt skjema; konkret kontekst/tekst viser hvilket som redigeres.
- Personlig notat = post-it. Kommentar i original = samme rene, sirkulære informasjonssymbol som appinformasjon.
- Langtrykk og dra for å flytte setlisteelementer. Ingen permanent flytteknapp.
- Lagre = diskett. Synkroniser = sirkelpil. Publiser = systemdeling. Eksporter = fil med nedoverpil.
- Flytende pluss er en komponent med transparent glassflate og subtil kant; selve ikonformen er et vanlig pluss.
- Sticky bruker pin-on for aktiv og pin-off for frigjort tilstand. Knappen er synlig og betjenbar i begge tilstander og veksler sticky av/på. Den dempede pinnen betyr ikke at knappen er deaktivert.
- «Upublisert» har ikke eget ikon. Vis aktuell status med tekst der det gir verdi, og skille fra ulagret og usynkronisert.

## Status

- Dette er et revidert **designutkast**, ikke en endring i repositoryet eller en endelig kodebestilling.
- «Akkord» bruker den avtalte enkle, åpne noten (i stedet for teknisk `[C]`).
- «Kommentar» og «Informasjon» bruker nøyaktig samme `info.svg`-symbol.
- «Toneart» viser ren G-nøkkel uten ekstra fortegn; «Stemming» viser stemmegaffel med lange armer og skaft.
- «Påminnelse» er kun «NB!» uten ramme. «Gulmarkering» viser bare merkepennen, uten strek/underlag.
- «Legg i setliste» holder pluss og setliste adskilt. «Dupliser» viser to ark og en pil opp mot høyre.
- «Festet» og «Frigjort» deler én symmetrisk, skråstilt pin-form. Frigjort er tydelig dempet.
- «Taktart» har den foreslåtte metronomen med ledeteksten «Taktart». Ikonets musikalske tvetydighet er kjent, men vi endrer ikke dette uten ny avklaring.

## Ikoner

### MUSIKALSKE BEGREPER OG TAGGER

| Fil | Visningstekst | Betydning |
|---|---|---|
| `fil-sang.svg` | Sang | G-nøkkel i dokument |
| `akkord.svg` | Akkord | Åpen note |
| `akkordskjema.svg` | Akkordskjema | Felles eller personlig |
| `key.svg` | Toneart | G-nøkkel uten fortegn |
| `time.svg` | Taktart | Metronom |
| `capo.svg` | Capo | Klemme i profil |
| `stemming.svg` | Stemming | Stemmegaffel |
| `vers.svg` | Vers | Tekstlinjer |
| `refreng.svg` | Refreng | Markert tekstblokk |
| `gjenta-refreng.svg` | Gjenta refreng | Løkkepil |
| `dynamikk.svg` | Dynamikk | Kurve |
| `info.svg` | Kommentar | Samme infoikon som systeminformasjon |
| `notat.svg` | Personlig notat | Post-it med brettet hjørne |
| `gulmarkering.svg` | Gulmarkering | Bare merkepennens tupp |
| `pause.svg` | Pause | Halvliter i setliste |
| `paaminnelse.svg` | Påminnelse | NB! uten ramme |
| `ratekst.svg` | Råtekst | ChordPro-kilde |
| `personlig.svg` | Personlig | Personlig datalag |
| `felles.svg` | Originalinnhold | ChordPro / arbeidskopi |

### HANDLINGER OG REDIGERING

| Fil | Visningstekst | Betydning |
|---|---|---|
| `tilbake.svg` | Tilbake | Navigasjon |
| `meny.svg` | Flere handlinger | Når meny faktisk finnes |
| `ny.svg` | Legg til her | Pluss i glassknapp |
| `legg-til.svg` | Legg i setliste | Fra sangbibliotek |
| `rediger.svg` | Rediger | Direkte redigering |
| `lagre.svg` | Lagre | Diskett |
| `angre.svg` | Angre | Felles historikk |
| `gjenta.svg` | Gjør om | Felles historikk |
| `viskelaer.svg` | Viskelær | Fjern formatering |
| `fjern.svg` | Fjern fra liste | Fjerner bare referansen |
| `slett.svg` | Slett | Faktisk sletting |
| `dupliser.svg` | Dupliser | To ark med pil ↗ |
| `filter.svg` | Filter | Bibliotek / kilde |
| `innstillinger.svg` | Innstillinger | Appvalg |
| `kryss.svg` | Lukk | Lukk panel |
| `pin-on.svg` | Festet | Sticky på |
| `pin-off.svg` | Frigjort | Samme pin, tydelig dempet |

### FILER, STATUS OG NAVIGASJON

| Fil | Visningstekst | Betydning |
|---|---|---|
| `synkroniser.svg` | Synkroniser | Sirkelpil |
| `importer.svg` | Importer | Fil inn |
| `eksporter.svg` | Eksporter | Fil ut |
| `publiser.svg` | Publiser | OS-deling |
| `kilde.svg` | Kilde | Ekstern eller lokal |
| `kilde-mangler.svg` | Kilde mangler | Behold reserve |
| `offline.svg` | Offline | Ingen nett |
| `ok.svg` | Fullført | Bekreftet handling |
| `konflikt.svg` | Konflikt | Brukervalg kreves |
| `info.svg` | Informasjon | Systeminformasjon |
| `varsel.svg` | Advarsel | Ved behov |
| `songlist.svg` | Sangbibliotek | Liste over sanger |
| `setliste.svg` | Setlister | Ordnet sangliste |
| `visning.svg` | Visning | Sang kan spilles |
| `personlig.svg` | Personlig data | Privat datalag |
