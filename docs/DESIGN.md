# Designprinsipper

## Implementert sangflyt

Startsiden gir filvalg og én alfabetisk oversikt over lokale sanger. Hver rad viser tittel og filnavn med løpenummer, slik at også gjentatte innlesinger kan velges separat. Sangen åpnes etter fullført lagring. «Mine sanger» og ordmerket går tilbake til oversikten; hver sangåpning starter øverst med fokus på tittelen.

Sangvisningen bruker en bredere, venstrestilt leseflate enn det opprinnelige appskallet. Tekst har seriffont, akkorder en tydelig varm kontrastfarge, og kommentarer egen dempet kursiv typografi. Refreng har overskrift og diskret sidemarkering. Definerte refrengblokker vises fullt; hver senere henvisning har en egen trykk-/tastaturkontroll med `aria-expanded`. Tilstanden endres først etter vellykket lagring.

Visningsvalg gjelder alle sanger i samme miljø: skriftstørrelse 16–36 px, standard 22 px, og eksplisitt lyst/mørkt tema. Mørkt er standard også ved lyst OS-tema. Kontrollene og app-/offlineinformasjon ligger etter sangen for å holde leseflaten rolig. En tilgjengelig appoppdatering gir i tillegg et diskret, fast varsel som kan brukes uten å forlate lesestedet. Oppdatering skjer først ved brukerens trykk. Begge temaer har synlig fokus, tydelige kontrollnavn og minst 44 px berøringshøyde. Vanlig sangtekst tilpasses 320 px, nettbrett og desktop uten sideveis scrolling.

Felles akkordskjema står på sin opprinnelige plass som en innrammet flate med overskrift/etikett, takter, slagceller, repetisjonstegn og marginmerknader. Takter får lik spaltebredde og tilpasses skjermen; ved liten bredde/stor skrift brytes takter og eventuelt slagceller videre innenfor samme takt. Lange/ukjente merknader bevares som lesbar tekst. Ingen sticky-visning brukes for felles skjema.

Dynamikkprofilen ligger dempet og symmetrisk bak leseinnholdet, med felles midtakse også i innrykkede refreng. Fem faste bredder viser nivået uten gradient, animasjon eller automatisk crescendo. Default er 3. Visningsvalgene «Vis felles akkordskjema» og «Vis dynamikkprofil» huskes per miljø og kan slås av uavhengig av hverandre. Dynamikkendringer har også tekst for skjermleser. Utformingen er et konkret forslag til vurdering på testadressen.

Test har synlig «Testversjon», eget TEST-merket installasjonsikon og PR/commit i bunnteksten. Nettstatus, installasjonshjelp og eksplisitt appoppdatering er beholdt. Fullverdig bibliotek og fremføringsfunksjoner nedenfor er fortsatt senere leveranser; konkret sangdesign prøves med produktansvarlig i testutgaven.

## Vedtatte prinsipper for senere v1

- Fremføring prioriterer lesbarhet og nødvendig informasjon uten å åpne notater/menyer. Manuell scroll, ingen autoscroll. Ingen unødig lys/støy eller preg av gammeldags administrasjon.
- Mørk standard og selvvalgt lys/mørk modus uavhengig av OS. Personlig skriftstørrelse huskes på tvers av sanger. Wake Lock der støttet, med brukerinnstilling og ærlig håndtering av plattformbegrensninger. Ingen ekstra fullskjermkontroll kreves.
- Biblioteket er én alfabetisk liste med husket kildefilter. Rader viser tittel, klingende toneart og relevante kommentarer; kilde bare ved behov. Ingen søk/bokstavgrupper i v1.
- Personlige notater/markeringer er synlige under spilling, endres i egen notatmodus og kan være korte uten å begrenses til én linje. Selektive gule tekstspenn/hele linjer støttes; ingen ekstra vertikal strek eller frihånd.
- **Retning, ikke ferdig utforming:** notater helst på høyre side, også i overlegg med halvgjennomsiktig bakgrunn. Underliggende tekst kan skimtes. Kontrast, transparens, plassering og mobilvariant avgjøres gjennom skisser/test, uten generelt overlappsforbud.
- Klingende toneart, capo og grep er samtidig synlige, også i setlisteraden. Stemming vises som tekst, på raden bare ved avvik fra standard. Capo endres i sanginnstillinger, ikke på raden.
- Første refreng er alltid fullt og kan ikke foldes; senere refrengforekomster åpnes/lukkes direkte og huskes personlig hver for seg.
- Felles grid blir stående i teksten. Personlig skjema er synlig under tittelen før teksten og har sticky på som standard. × frigjør bare aktuell visning. For høyt skjema på liten skjerm komprimeres uten separat scrolling.
- Felles dynamikk er en diskret, symmetrisk, midtstilt bakgrunnsprofil med fem nivåer. Bredde er intensitet, ingen automatisk crescendo eller påstått musikalsk tidslinje fra tekstlinjeantall. Grunnprofil og av/på er implementert; videre detaljutforming vurderes på testadressen.
- Formatert editor som standard, full råtekst ved valg, relevante kontekstvalg ved markering fremfor permanent verktøylinje. God desktop/tastatur-/markeringsstøtte. Kontroll/godkjenning av konverteringsforslag uten automatisk omskriving av ordlyd.
- Setliste har tydelig adskilt redigering og fremføring, egne rader for pauser/påminnelser, markeringsrekkefølge ved flervalg og langt trykk/dra for omordning. Ingen egen konsertmodus eller Lagre/Angre-knapp i setlisteeditoren.
- Sang starter alltid øverst. Sidesveip følger også pauser/påminnelser. Retur viser sist element markert og posisjonert nær naturlig vertikal midtstilling uten synlig scrollanimasjon eller kunstig luft.
- Konflikter/usikker annoteringsmatching skal kunne utsettes. Varsler er tydelige uten å kreve umiddelbar avklaring før spilling. Manuell synk og diskrete påminnelser gir ingen overraskende bakgrunnsendringer.

## Åpne utformingsoppgaver

Eierens vurdering av konkrete nettbrett-/mobilskisser for bibliotek, sangvisning med notater/skjema/dynamikk, setlister og redigeringsmodi gjenstår. Prøv plassbruk, lesbarhet, berøring og navigasjon. Kompakt sticky-høyde, notatoverlegg og dynamikkontroller/-profil avgjøres der. Detaljert annoteringsgjenforankring og eventuell sist gjennomgåtte fremføringsversjon er fortsatt teknisk/designmessig arbeid.

Dette er ikke en ny runde med avklarte domenespørsmål eller et krav om ferdig visuelt v1-design for å godkjenne appskallet. De bindende funksjonsreglene står i [REQUIREMENTS](REQUIREMENTS.md), mens faktisk verifikasjon og fysiske plattformer står i [TESTING](TESTING.md).
