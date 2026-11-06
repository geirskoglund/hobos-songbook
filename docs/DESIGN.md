# Designprinsipper

## Appskallet nå

Den implementerte flaten er bare startside med navn, miljø, PR/master/commit, offline-status, oppdatering og kort installasjonshjelp. En dempet mørk bakgrunn, varme detaljer og lokal bokillustrasjon gir en enkel, lesbar inngang. Test har synlig «Testversjon» og eget TEST-merket installasjonsikon. Det finnes ingen sangdemoer eller kontroller som antyder at senere funksjoner virker.

Layouten tilpasser seg mobil, nettbrett og desktop uten sideveis scrolling. Tekst og knapper tåler linjebryting. Tastaturfokus er synlig, status bruker tekst i tillegg til farge, og appen bruker lokal systemfont uten kjøretids-CDN. Skallet fastsetter **ikke** endelig visuelt design for bibliotek, sangvisning, editor eller setlister.

## Vedtatte prinsipper for senere v1

- Fremføring prioriterer lesbarhet og nødvendig informasjon uten å åpne notater/menyer. Manuell scroll, ingen autoscroll. Ingen unødig lys/støy eller preg av gammeldags administrasjon.
- Mørk standard og selvvalgt lys/mørk modus uavhengig av OS. Personlig skriftstørrelse huskes på tvers av sanger. Wake Lock der støttet, med brukerinnstilling og ærlig håndtering av plattformbegrensninger. Ingen ekstra fullskjermkontroll kreves.
- Biblioteket er én alfabetisk liste med husket kildefilter. Rader viser tittel, klingende toneart og relevante kommentarer; kilde bare ved behov. Ingen søk/bokstavgrupper i v1.
- Personlige notater/markeringer er synlige under spilling, endres i egen notatmodus og kan være korte uten å begrenses til én linje. Selektive gule tekstspenn/hele linjer støttes; ingen ekstra vertikal strek eller frihånd.
- **Retning, ikke ferdig utforming:** notater helst på høyre side, også i overlegg med halvgjennomsiktig bakgrunn. Underliggende tekst kan skimtes. Kontrast, transparens, plassering og mobilvariant avgjøres gjennom skisser/test, uten generelt overlappsforbud.
- Klingende toneart, capo og grep er samtidig synlige, også i setlisteraden. Stemming vises som tekst, på raden bare ved avvik fra standard. Capo endres i sanginnstillinger, ikke på raden.
- Første refreng er alltid fullt og kan ikke foldes; senere refrengforekomster åpnes/lukkes direkte og huskes personlig hver for seg.
- Felles grid blir stående i teksten. Personlig skjema er synlig under tittelen før teksten og har sticky på som standard. × frigjør bare aktuell visning. For høyt skjema på liten skjerm komprimeres uten separat scrolling.
- Felles dynamikk er en diskret, symmetrisk, midtstilt bakgrunnsprofil med fem nivåer. Bredde er intensitet, ingen automatisk crescendo eller påstått musikalsk tidslinje fra tekstlinjeantall. Utforming/kontroller prøves senere; funksjonen inngår i v1.
- Formatert editor som standard, full råtekst ved valg, relevante kontekstvalg ved markering fremfor permanent verktøylinje. God desktop/tastatur-/markeringsstøtte. Kontroll/godkjenning av konverteringsforslag uten automatisk omskriving av ordlyd.
- Setliste har tydelig adskilt redigering og fremføring, egne rader for pauser/påminnelser, markeringsrekkefølge ved flervalg og langt trykk/dra for omordning. Ingen egen konsertmodus eller Lagre/Angre-knapp i setlisteeditoren.
- Sang starter alltid øverst. Sidesveip følger også pauser/påminnelser. Retur viser sist element markert og posisjonert nær naturlig vertikal midtstilling uten synlig scrollanimasjon eller kunstig luft.
- Konflikter/usikker annoteringsmatching skal kunne utsettes. Varsler er tydelige uten å kreve umiddelbar avklaring før spilling. Manuell synk og diskrete påminnelser gir ingen overraskende bakgrunnsendringer.

## Åpne utformingsoppgaver

Eierens vurdering av konkrete nettbrett-/mobilskisser for bibliotek, sangvisning med notater/skjema/dynamikk, setlister og redigeringsmodi gjenstår. Prøv plassbruk, lesbarhet, berøring og navigasjon. Kompakt sticky-høyde, notatoverlegg og dynamikkontroller/-profil avgjøres der. Detaljert annoteringsgjenforankring og eventuell sist gjennomgåtte fremføringsversjon er fortsatt teknisk/designmessig arbeid.

Dette er ikke en ny runde med avklarte domenespørsmål eller et krav om ferdig visuelt v1-design for å godkjenne appskallet. De bindende funksjonsreglene står i [REQUIREMENTS](REQUIREMENTS.md), mens faktisk verifikasjon og fysiske plattformer står i [TESTING](TESTING.md).
