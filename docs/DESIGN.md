# Designprinsipper

## Implementert sangflyt

Startsiden gir filvalg og én alfabetisk oversikt over lokale sanger. Rader viser tittel og filnavn med løpenummer, slik at gjentatte innlesinger kan velges separat. Sangvisningen har en fast, kompakt topp med tilbakeknapp, ordmerke, miljømerking og meny. Hver åpning starter øverst. Innstillinger, installasjon/offline, oppdatering, nettstatus og byggidentitet ligger i menyen, ikke under sangteksten. Menyen er en tilgjengelig dialog med Escape/fokusretur; visningsvalgene gjelder alle sanger i samme miljø.

Tittel og toneart bruker lite plass. Tonearten vises alene i en diskret pille, uten synlig ledetekst; skjermleser får «Toneart: …». En egen pille ved siden av kan senere vise for eksempel «Capo 7: Am» når capo leveres. Sangtekst har lesbar seriffont med 1,2 linjeavstand, akkorder en varm kontrastfarge og kommentarer egen dempet typografi. Første refreng vises fullt. Senere henvisninger er en diskret tekstkontroll «Refreng», uten ramme, bakgrunn eller pluss/minus. Kontrollen har ingen vertikal padding og bruker minst 24 px høyde, uten å reservere en ekstra tekstlinje. Direkte trykk eller tastatur åpner/lukker og lagrer tilstanden. Fokus og `aria-expanded` beholdes.

Samlet visuell avstand mellom rendret sanginnhold er høyst én tekstlinje. Blanklinjer fra filen og layoutavstand summeres ikke; én eller flere blanklinjer gir en kompakt pause på en halv tekstlinje. Kommentarer og refrengoverskrifter bruker også 1,2 linjeavstand; akkordrekken har tettere sats uten å bryte koblingen til teksten. Når kilden ikke har blanklinje mellom innholdselementene, legges ingen ekstra avstand til, heller ikke rundt kommentarer og refrengoverskrifter. Originalfilen bevares uendret.

Det finnes én kompakt skjemavisning: personlig innhold først, ellers felles grid fra filen, ellers ingen. Alle felles blokker samles i original rekkefølge i den samme flaten, med eventuelle musikalske etiketter og merknader. Ingen generisk overskrift om at skjemaet er felles vises. Skriftstørrelsen for skjemaet er 14 px, uavhengig av sangtekstens 16–36 px. Visningen fester seg under toppen. × slår av sticky for aktuell åpning, mens skjemaet blir stående på sin opprinnelige plass i siden. Neste åpning har sticky på igjen. For høyt innhold komprimeres samlet til omtrent 30 prosent av vindushøyden uten egen scrolling. Privat skjema bruker identisk presentasjon; opprettelse/redigering er utsatt.

Dynamikk er én smal, sammenhengende SVG-form bak sangteksten. Profilen er dempet, men synlig mot bakgrunnen i begge temaer: lys grønngrå med omtrent 9 prosent dekkevne i mørkt tema og mørk grønngrå med omtrent 11 prosent i lyst tema. Formen er symmetrisk rundt midten og har myke, lokale overganger ved nivåskifte. Maksimal bredde er 112 px og aldri over 22 prosent av leseområdets bredde. Fem nivåer bruker 24/40/58/78/100 prosent av denne smale maksimumsbredden; normalnivå er 3. Ingen automatisk animasjon, gradient eller musikalsk tidsmåling brukes. Formen beregnes på nytt ved ombrekking, skriftendring og refrengfolding. Dynamikkendringer har også tekst for skjermleser.

Tema, skriftstørrelse og av/på for skjema/profil huskes per miljø. Mørkt er standard uavhengig av OS. Begge temaer har synlig fokus, tydelige kontrollnavn og lesbarhet ved 320 px, nettbrett og desktop. En ekte appoppdatering gir et diskret varsel uten å kreve at menyen er åpen. Aktivering skjer først ved brukerens trykk. Produksjon/test er synlig merket; PR/commit kan leses i menyen.

## Vedtatte prinsipper for v1

- Fremføring prioriterer lesbarhet og nødvendig informasjon uten å åpne notater/menyer. Manuell scroll, ingen autoscroll. Ingen unødig lys/støy eller preg av gammeldags administrasjon.
- Mørk standard og selvvalgt lys/mørk modus uavhengig av OS. Personlig skriftstørrelse huskes på tvers av sanger. Wake Lock der støttet, med brukerinnstilling og ærlig håndtering av plattformbegrensninger. Ingen ekstra fullskjermkontroll kreves.
- Biblioteket er én alfabetisk liste med husket kildefilter. Rader viser tittel, klingende toneart og relevante kommentarer; kilde bare ved behov. Ingen søk/bokstavgrupper i v1.
- Personlige notater/markeringer er synlige under spilling, endres i egen notatmodus og kan være korte uten å begrenses til én linje. Selektive gule tekstspenn/hele linjer støttes; ingen ekstra vertikal strek eller frihånd.
- **Retning, ikke ferdig utforming:** notater helst på høyre side, også i overlegg med halvgjennomsiktig bakgrunn. Underliggende tekst kan skimtes. Kontrast, transparens, plassering og mobilvariant avgjøres gjennom skisser/test, uten generelt overlappsforbud.
- Klingende toneart, capo og grep er samtidig synlige, også i setlisteraden. Stemming vises som tekst, på raden bare ved avvik fra standard. Capo endres i sanginnstillinger, ikke på raden.
- Første refreng er alltid fullt og kan ikke foldes; senere refrengforekomster åpnes/lukkes direkte og huskes personlig hver for seg.
- Én skjemavisning bruker personlig innhold først, ellers felles innhold. Den har sticky på som standard; × frigjør den bare fra sticky for aktuell åpning og beholder innholdet på sin opprinnelige plass. For høyt skjema komprimeres uten separat scrolling.
- Felles dynamikk er en diskret, symmetrisk, midtstilt bakgrunnsprofil med fem nivåer. Bredde er intensitet, ingen automatisk crescendo eller påstått musikalsk tidslinje fra tekstlinjeantall. Grunnprofil og av/på er implementert; videre detaljutforming vurderes på testadressen.
- Formatert editor som standard, full råtekst ved valg, relevante kontekstvalg ved markering fremfor permanent verktøylinje. God desktop/tastatur-/markeringsstøtte. Kontroll/godkjenning av konverteringsforslag uten automatisk omskriving av ordlyd.
- Setliste har tydelig adskilt redigering og fremføring, egne rader for pauser/påminnelser, markeringsrekkefølge ved flervalg og langt trykk/dra for omordning. Ingen egen konsertmodus eller Lagre/Angre-knapp i setlisteeditoren.
- Sang starter alltid øverst. Sidesveip følger også pauser/påminnelser. Retur viser sist element markert og posisjonert nær naturlig vertikal midtstilling uten synlig scrollanimasjon eller kunstig luft.
- Konflikter/usikker annoteringsmatching skal kunne utsettes. Varsler er tydelige uten å kreve umiddelbar avklaring før spilling. Manuell synk og diskrete påminnelser gir ingen overraskende bakgrunnsendringer.

## Åpne utformingsoppgaver

Eierens vurdering av konkrete nettbrett-/mobilskisser for bibliotek, sangvisning med notater/skjema/dynamikk, setlister og redigeringsmodi gjenstår. Prøv plassbruk, lesbarhet, berøring og navigasjon. Kompakt sticky-høyde, notatoverlegg og dynamikkontroller/-profil avgjøres der. Detaljert annoteringsgjenforankring og eventuell sist gjennomgåtte fremføringsversjon er fortsatt teknisk/designmessig arbeid.

Dette er ikke en ny runde med avklarte domenespørsmål eller et krav om ferdig visuelt v1-design for å godkjenne appskallet. De bindende funksjonsreglene står i [REQUIREMENTS](REQUIREMENTS.md), mens faktisk verifikasjon og fysiske plattformer står i [TESTING](TESTING.md).
