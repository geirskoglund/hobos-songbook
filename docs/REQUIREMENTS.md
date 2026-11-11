# Gjeldende krav

Dette er produktkrav, ikke en liste over ferdige funksjoner. **Implementert:** PWA/offline, miljøidentitet, oppdatering og CI/CD; lokal UTF-8 ChordPro/TXT-innlesing, sanglagring, sangboktilhørighet og alfabetisk sangliste med husket filter; kompakt sangvisning med individuelle refrengvalg, felles/personlig akkordskjema og femnivå-dynamikk; personlig redigering av capo, stemming, skjema, notater og gulmarkering med utkast og eksplisitt «Lagre»; originaleditorens grunnflate med ny lokal sang, tittel, valgfri toneart/takt og enkel tekst fra issue #14.

Grunnlaget er godkjente og mergede [PR #5](https://github.com/geirskoglund/hobos-songbook/pull/5) (issue #4), [PR #7](https://github.com/geirskoglund/hobos-songbook/pull/7) (issue #6), [PR #9](https://github.com/geirskoglund/hobos-songbook/pull/9) (issue #8 med produktansvarligs presiseringer) og [PR #10](https://github.com/geirskoglund/hobos-songbook/pull/10) (publisering). **Gjenstående vedtatt v1-funksjonalitet:** administrasjon av sangbøker og eksterne kilder, originaleditorens musikalske verktøy og konvertering, setlister, Dropbox/synk, eksport/backup og skjermvåkenhet. Se §10. Automatisert verifikasjon og publiseringskontroller er rapportert i PR-ene; fysisk iPad/Safari, Android/Chrome og installert PWA er ikke verifisert av Codex. Gjenværende plattformkontroller står i [TESTING](TESTING.md).

Opprinnelig grunnlag er den daterte spesifikasjonen 5. november 2026 i [issue #1, del 1–4](https://github.com/geirskoglund/hobos-songbook/issues/1#issuecomment-6673680408) og avklaringene i samme issue. GitHub er autoritativ kilde etter oppstartsleveransen; Drive-originalen og de uendrede kommentarene er historisk kilde. Seksjonsnumrene følger originalen. **[B]** betyr besluttet, **[Å]** uavklart, **[RETNING]** foretrukket designretning. Tekniske/designmessige vurderingspunkter er ikke testbevis eller godkjenning av en bestemt løsning.

## 1. Mål og bruk

- **[B]** Moderne sangbok primært for nettbrett under øving/konsert, også mobil og PC/Mac, både for band og privat på tvers av prosjekter. PC/Mac er særlig viktig for import/redigering. Uttrykket skal ikke oppleves som et gammeldags administrasjonsverktøy.
- **[B]** Offline-first PWA på statisk GitHub Pages, uten egen backend eller skydatabase. Appen skal kunne installeres og kjøre standalone der plattformen støtter det. Ingen separat fullskjerm-/skjul-nettleser-kontroll i v1; nettleserens UI-begrensninger gjelder ved vanlig nettleserbruk.
- **[B]** Manuell scrolling, ikke autoscroll. Nødvendig fremføringsinformasjon er synlig uten å åpne notater/menyer.
- **[B]** Når brukeren tar i bruk en ny appversjon, beholdes aktiv skjerm og posisjon generelt i hele appen, inkludert oversikt, sang og åpen hovedmeny og Innstillinger-side. Oppdateringen skal ikke sende brukeren til førstesiden. Tilstanden gjelder aktuell fane og miljø.
- **[B]** Sangvisning og setliste holder som standard skjermen våken via støttet nettleserfunksjon. Brukeren kan slå dette av. Manglende plattformstøtte håndteres uten å love at dvale alltid kan hindres.
- **[B]** Skriftstørrelse i sangvisning justeres og huskes som personlig innstilling på tvers av sanger. V1 bruker fast mørkt Organisk-tema uavhengig av OS; lysmodus og temavelger inngår ikke. Eldre lagret lysmodus normaliseres uten å slette andre innstillinger.
- **[B]** Appen styrer tekst- og kontekstbetjening på alle skjermer, også i skrivefelt. Nettleserens tekst-/lenkemenyer, native verktøytips og valideringsballonger erstattes av appens egne utvalg, feltmenyer, verktøytips og feilvisning. Merk alt, klipp/kopier, innliming, angre og vanlig tekstinnskriving beholdes. Innliming bruker eksisterende utklippstavletilgang eller tastaturet uten ny tilgangsforespørsel. Nettleserens hovedmenyer og nødvendige OS-funksjoner som filvalg/skjermtastatur er utenfor denne kontrollen. Se [DESIGN](DESIGN.md#felles-interaksjonsprinsipp).

- **[B] Felles designsystem (#23):** Organisk brukes i alle eksisterende flater. Hovedmenyen er et høyre sidepanel under synlig header med hamburger; Innstillinger er egen side. Setlister, Synkronisering og Filer har foreløpig bare tittel/navigasjon. Dialoger gjenbruker ramme/footer for 1/2/3 handlinger uten endret lagringsbetydning. Kontroller implementeres én gang og kalles fra flere steder; overordnet layout vedlikeholdes ett sted.

## 2. Domenemodell, bibliotek og sletting

- **[B] Kilde:** Dropbox-mappe registrert med delt lenke; mange egne og delte kilder støttes.
- **[B / IMPLEMENTERT] Sangbok:** egen entitet med navn og stabil intern ID; erstatter det tidligere grupperingsbegrepet kontekst og er adskilt fra fil-/Dropbox-kilde og setliste. Hver sang tilhører én sangbok. Standard opprettes én gang, og gamle sanger uten tilhørighet migreres dit uten datatap. Nye og importerte sanger får foreløpig Standard, uavhengig av filter. Administrasjon av bøker og at en Dropbox-integrasjon kan definere en sangbok kommer senere.
- **[B / IMPLEMENTERT] Bibliotek:** forsiden Sanger har én sammenhengende alfabetisk liste. Midtstilt filter viser Alle eller én valgt sangbok; valget huskes på tvers av sider og oppstart per miljø. Alle er et filter, ikke en bok. Ugyldig lagret valg faller tilbake til Alle. Sangbokvelgeren viser Alle øverst, deretter registrerte bøker alfabetisk, uten opprettelseshandling. Ingen bokstavgruppering, fritekstsøk eller søkefelt i v1.
- **[B / IMPLEMENTERT] Sangrad:** tittel med metadata i rekkefølgen klingende toneart, takt (4/4 ved fravær), personlig capo med beregnet grepstoneart og alternativ stemming. Capo 0 og standard stemming skjules; manglende toneart gir ingen oppdiktet grepstoneart. Metadata brytes på smale flater. Raden åpner valgt sang i sangvisning; radmenyen er fjernet, og Rediger finnes i sangvisningens header.
- **[B] Sang:** selvstendig oppføring fra konkret kildefil eller privat opprettelse. Lik tittel i ulike kilder er ikke samme sang.
- **[B] Setliste:** ordnet samling av sangreferanser på tvers av kilder; også øvingsliste eller personlig repertoar. Internt dupliseres ikke sanginnholdet. Sangbok er gruppering av sanger; setliste er en ordnet samling av sangreferanser.
- **[B] Personlig lag:** egne notater, markeringer, capo og akkordgrep er adskilt fra felles originalfil.

**[B] Konsoliderte sletteregler** (også original §8 og §10):

1. Sangfiler som finnes i Dropbox, også i brukerens private App folder, slettes utenfor appen. V1 har ingen «Fjern fra biblioteket» for å slette bare lokal synkronisert kopi eller frigjøre plass, og ingen separat brukeraktivert logisk sletting/skjuling.
2. Bekreftet fysisk sletting i kilden skjuler sangen fra ordinært bibliotek og vanlig sangvalg ved bygging av setlister. Lokal reservekopi beholdes, synlig og tydelig markert under «Vis slettede sanger». Tilgangs-/synkfeil er ikke bevis for sletting.
3. Reservekopien kan inspiseres, eksporteres som fil for manuell tilbakeføring og slettes permanent manuelt. Ingen automatisk opprydding, Dropbox-gjenoppretting eller «angre fysisk sletting» ved bare å endre status. «Vis slettede sanger» gjenoppretter ingen ekstern fil.
4. En sang som aldri har hatt ekstern kildefil og bare er opprettet/lagret lokalt, kan slettes i appen etter bekreftelse.
5. Fjerning av sangreferanse fra setliste eller sletting av hele setlisten sletter aldri sangen eller kildefilen. Se §6 for reserveinnhold når kilde senere mangler.

## 3. Sangformat, import og editor

### Felles redigeringsinngang, utkast og lagring

- **[B]** Ordinær sangvisning er beskyttet fremføring. Berøring, scrolling og langt trykk åpner ingen redigeringskontroller eller endrer personlige tilpasninger. Refrengfolding og av/på for sticky-skjema virker direkte og regnes ikke som redigering.
- **[B]** «Rediger» i sangens header åpner samme sang som arbeidsflate. Den faste ikonverktøylinjen fyller bredden under appens topp og har Lagre til venstre, deretter markeringspenn, notat og skjema. Sanginnholdet har reservert plass under linjen. Ikonet «Rediger sangtekst» åpner originaleditoren over samme økt, med tydelig skille mellom personlig lag og originalinnhold.
- **[B]** Endringer beholdes som utkast inntil brukeren velger «Lagre», som skriver dem til lokal lagring. Lagre er aktiv bare ved bekreftede endringer fra sist lagrede verdier og avslutter ikke redigeringen. Original- og personlige endringer bekreftes lagret først etter én fullført transaksjon for alle endrede felt. Feil beholder utkastet for nytt forsøk.
- **[B]** Små redigerere har Avbryt og OK i en integrert felles dialogfooter. OK bekrefter popupens utkast i sangen og lukker boksen; Avbryt, Escape og fullført utvendig trykk forkaster popupens endringer uten spørsmål. Åpning, inntasting og lukking skriver ikke vedvarende. Scrolling utenfor en popup forkaster den ikke. Aktivering krever fullført trykk; scroll, dra og avbrutt berøring åpner ikke redigerere.
- **[B]** Tilbake/«Avslutt redigering» returnerer til utgangspunktet, enten oversikten eller samme fremføringsvisning med lesested så langt som praktisk mulig. Ved ulagret arbeid tilbys «Lagre og gå ut», «Forkast endringer» og «Fortsett redigering». Vanlig lukking/omlasting varsler om ulagret arbeid. Appoppdatering venter på pågående lagring og stopper ved ulagret arbeid eller lagringsfeil.

Den bekreftede sangen og personlige tilpasninger har ett felles arbeidsutkast. Dialoger har midlertidige utkast frem til OK; visning og lagring bruker samme bekreftede utkast og ett sist lagret sammenligningsgrunnlag.

Ved manuell filinnlesing med et allerede importert filnavn, inkludert filendelse, vises «Fil [filnavn.filendelse] er allerede importert. Vil du importere en kopi?» med Avbryt og Importer. Avbryt gjør ingen endring; Importer oppretter ny sang-ID. Innholdet brukes ikke til dublettkontroll. Vurderingslogikken holdes adskilt fra dialog og lagring for senere kilde-/sangbokregler; dette fastsetter ikke identitetsreglene for synk.

### Sangformat, originaleditor og konvertering

Grunnflaten fra issue #14 er implementert: ny lokal sang, eget tittelfelt, valgfri toneart/takt og sammenhengende enkel sangtekst i fullskjermsmodal over den personlige redigeringsvisningen. Musikalske verktøy, full råmodus, felles økthistorikk, transponering, eksport følger i #15–#21; konvertering kommer senere.

- **[B / IMPLEMENTERT]** Flytende pluss nederst til høyre på sanglisten åpner Kontekstmeny med Opprett og Importer. Opprett åpner direkte med tom tittel/tekst, uten opprettelsesskjema. Importer åpner eksisterende systemfilvalg for én støttet UTF-8-fil og viser sangen først etter vellykket lagring. Navigasjon fra en åpen sang avklarer ulagret arbeid med de eksisterende lagre/forkast/fortsett-valgene før byttet. Første Avbryt avvikler opprettelsen. OK krever en ikke-tom tittel og viser bare et ulagret utkast; tom sangtekst er tillatt. Første vellykkede Lagre oppretter én stabil lokal ID, også ved like titler. Forkasting før lagring etterlater ingen sang/personpost.
- **[B / IMPLEMENTERT]** Modalens OK overfører til øktens utkast; Avbryt forkaster bare aktuell modalåpning. Metadata-popuper har samme eget utkast. Toneart kan angis første gang uten akkordflytting; en allerede angitt toneart er låst til transponering leveres. Valgfri takt kan endres uten akkordendring; vist standard 4/4 skriver ikke et nytt direktiv.
- **[B / IMPLEMENTERT]** Enkel tekst har egen scroll, appens tekstmeny og tastatursnarveier. Tittelfelt og sangtekst følger begge valgt skriftstørrelse. Åpning fokuserer dialogens topp uten å aktivere skjermtastaturet. Modalhandlingene følger synlig viewport, også ved skjermtastatur. Uendret åpning/OK eller personlig lagring bevarer eksakt original. Støttede endringer bruker avgrensede kildeområder; uberørt BOM, linjeskift, taggstavemåte og kildeinformasjon bevares.
- **[B / MIDLERTIDIG VERN]** Musikalske/ukjente strukturer og metadata midt i teksten vises beskyttet. Forhåndsvisningen viser sanginnholdet direkte uten dynamikkgrafikk eller personverktøy. Metadata kan endres tapsfritt, men originale endringer med refreng/forekomstvalg sperres med konkret forklaring og synlig låste felter. Annoteringer bruker egne regler ved tekstoppdatering og sperrer ikke en ellers støttet originalendring. Tvetydig metadata sperres ved endring. Uendret original og trygg personlig redigering tillates fortsatt. Ingen råkoder kan introduseres gjennom innliming i enkel tekst.

- **[B]** Foretrukket format er ren tekst med ChordPro-kompatible direktiver, eksempelvis `{t:}`, `{title:}`, `{key:}`, `{soc}`, `{eoc}` og kommentarer. Akkorder i `[klammeparenteser]` støttes, men er ikke påkrevd.
- **[B]** Normal flyt er ekstern teksteditor, manuell filplassering i Dropbox og synk i appen. Appen tilbyr også opprettelse, redigering og konvertering i én felles editor. Lokal lagring følger utkast-/Lagre-modellen over og fungerer offline. Eksport/publisering skjer separat via OS-filfunksjoner, også til en PC/Mac-mappe som Dropbox selv synkroniserer.
- **[B]** Editor starter formatert. Full råtekst kommer i #19. Den faste formateringsverktøylinjen etableres synlig og tom i #14, står stille mens teksten scroller og får musikalske verktøy i #15–#18; korte forklarende tekstetiketter plasseres under ikoner der nødvendig. PC/Mac har god støtte for tastatur, markering og effektiv tekstredigering, ikke bare et mobilgrensesnitt.
- **[B]** Import av TXT/ChordPro, Word og PDF forsøker automatisk å finne vers, refreng, kommentarer og øvrig struktur og foreslår tagger. Forslaget er redigerbart og må gjennomgås/godkjennes før lagring. Sangtekstens ordlyd omskrives ikke automatisk. Regelbaserte forslag krever ingen innebygd AI-tjeneste.
- **[B]** Bare maskinlesbar tekst importeres i v1. Ingen OCR, skannede PDF-er eller bilder; ekstern AI/OCR kan brukes først ved behov. Konvertering skjer én sang om gangen, ingen batchkonvertering.
- **[B]** Undo/Redo har én felles historikk mellom formatert og rå modus. «Lagre» nullstiller ikke historikken. Historikken gjelder hele redigeringsøkten, også over modal-OK/gjenåpning og Lagre; Avbryt skal ikke kunne hentes tilbake med Redo. Dette leveres i #19. Vanlig tekstangre finnes nå. Publisering er separat; intet sangversjonssystem innføres.

### Arbeidskopi, publisering og konflikt

Ekstern arbeidskopimarkering og separat fileksport leveres i #21; Dropbox/synk kommer senere. Lokal Lagre skriver nå bare til enheten.

- **[B]** Redigering av sang fra delt Dropbox-kilde oppretter automatisk privat arbeidskopi. «Rediger» åpner direkte med utkast og eksplisitt «Lagre» som beskrevet over. Den lagrede arbeidskopien har diskret markering av upubliserte endringer. «Publiser» er en separat handling og utføres ikke av «Lagre» eller ved avslutning av redigering.
- **[B]** Kilden endres ikke før brukeren eksplisitt eksporterer/publiserer via OS/Dropbox utenfor lesebasert kildesynk. Synk overskriver ikke upubliserte arbeidskopier.
- **[B]** Dersom originalen er endret etter opprettelse av arbeidskopien, varsles konflikt med sammenligning av opprinnelig kilde, oppdatert kilde og arbeidskopi. Ingen versjon overskrives automatisk. Brukeren bestemmer og kan utsette håndtering.

### Refreng og eldre markører

- **[B]** Første `{soc}…{eoc}` viser hele teksten med overskriften «Refreng» og kan ikke foldes. Senere `{chorus}`-henvisninger har samme overskrift og åpnes/lukkes individuelt ved direkte trykk. Personlig tilstand lagres per forekomst og gjenopprettes ved neste åpning; nye gjentakelser starter sammenfoldet. Ingen separat kort/utvidet-innstilling. Originalfilen endres ikke.
- **[B]** Import foreslår `[Solo]`/`[Fele]` som `{comment: Solo}`/`{comment: Fele}`. Gjentatt `[Ref]` foreslås som `{chorus}` bare når et tidligere refreng er definert, ellers som `{comment: Refreng}`. Eldre markører skal ikke automatisk tolkes som akkorder bare fordi de bruker klammer.
- **[TEKNISK]** Parser, konverteringsregler og håndtering av tvetydighet klargjøres ved senere implementering. Manuell kontroll og godkjenning før lagring gjelder også normalisering.

## 4. Sangvisning, personlige notater og capo

### Notater, gulmarkering og forankring

Notater og gulmarkeringer bruker separate koordinatmodeller uten kopier av originalteksten. Felles håndtering av tekstoppdateringer brukes av originaleditoren og kan senere brukes av synk.

- **[B]** Trykk på en sang åpner lesbar sangvisning. Personlige notater/markeringer er umiddelbart lesbare mens man spiller, uten ekstra interaksjon, og endrer ikke felles sangfil.
- **[B]** Korte, konsise notater er normal bruk; visning/editor prioriterer korte instrukser uten krav om nøyaktig én linje. Opprettelse/redigering skjer i den felles modusen «Rediger»; vanlig sangvisning skal ikke lage notater ved utilsiktet berøring.
- **[B]** Selektiv personlig gulmarkering gjelder vilkårlige ord/tekstspenn, hele linjer eller ett sammenhengende område over flere logiske linjer, eksempelvis egne korord. Endres i den felles redigeringsmodusen. PC-tekstvalg bruker ikonverktøylinjen uten ekstra kontekstpopup. Pennen styrer eget utvalg og håndtak på berøring og PC og slås av etter ett fullført utvalg. Ny markering krever nytt valg av penn. Valgt gulmarkering har ett felles slettekryss og direkte endehåndtak for hele utvalget. Ingen egen vertikal strek eller frihåndstegning i v1.
- **[B]** Notater har egen identitet og en fast, nummerert logisk linjeposisjon, med gjentatte refrengforekomster skilt. Nummereringen følger eksplisitte innholdslinjer, inkludert tomme linjer og merknader, og påvirkes ikke av metadata eller automatisk linjebryting på ulike bredder. Notatene forsøker å bli ved posisjonen når innholdet endres; de følger ikke ord eller avsnitt. Notat opprettes fra levende tekstvalg eller et uttrykkelig plasseringsvalg, også i marg/tomme linjer; tidligere fokus gjenbrukes ikke. × på notatet sletter. Langt trykk og dra flytter notatet til en ny linjeforekomst i utkastet, uten ramme rundt mållinjen og uten å overskrive et eksisterende notat. Escape/avbrutt berøring avbryter; Alt+pil opp/ned gir tastaturalternativ.
- **[B]** Notater skjules eller slettes ikke ved tekstendring. Posisjoner utenfor innholdet plasseres så langt ned som mulig; kollisjoner legges sekvensielt nederst i stabil rekkefølge. Uten sangtekst vises alle notater under hverandre og kan fortsatt redigeres/flyttes. Gulmarkeringer lagres med linje-/tegnkoordinater. Sikre markeringer følger teksten ved oppdatering; usikre eller bortfalt tekst kan miste markeringen uten å markere feil ord. Ingen egne avklaringsdialoger, varslingslister eller historisk gjennomgang. Samme funksjonelle regel gjelder fremtidige eksterne tekstoppdateringer.
- **[RETNING]** Notater vises helst på høyre side, også som overlegg der det utnytter plassen bedre. Halvgjennomsiktig bakgrunn lar underliggende tekst skimtes. Denne retningen er tatt i bruk i den personlige editoren; konkret utforming er beskrevet i [DESIGN](DESIGN.md#personlig-redigering). Fysisk lesbarhet og berøring på mobil/nettbrett gjenstår å verifisere, uten et generelt forbud mot overlapp.
- **[TEKNISK]** Notater lagrer bare egen tekst og posisjon. Markeringsankere lagrer koordinater/forekomst, uten originaltekst eller omkringliggende tekst. Tomme annoteringer fjernes. Ved innføring av nytt annoteringsformat kan tidligere notater/gulmarkeringer i test forkastes; sanger og øvrige personlige innstillinger beholdes, og gamle felt skal ryddes før bruk og nye lagringer.
- **[B]** En særskilt «sist gjennomgått fremføringsversjon» inngår ikke i v1. Manuell synkronisering og de pragmatiske annoteringsreglene er tilstrekkelig. Reglene for plassering og databevaring over gjelder fortsatt.

### Klingende toneart, capo, stemming og eldre filer

- **[B]** `{key: ...}` er klingende toneart, uavhengig av personlig capo. I sangvisningen vises verdien alene i en diskret pille uten ledetekst. En egen pille ved siden av viser for eksempel «Capo 7: Am». Capo skrives ikke i felles sangfil. Klingende toneart og personlig capo-/grepstoneart er synlige samtidig, også på setlisteraden, slik at musikere kan kommunisere riktig toneart.
- **[B]** Personlig capo bestemmer visningen av både tekstakkorder og akkordskjema, samt innskriving i personlig skjema. Det finnes ikke et separat akkordvisningsvalg. Dette endrer ikke originalakkorder eller sangens toneart.
- **[B]** Nye filer tolkes som klingende akkorder som standard. Eldre filer med noterte capo-grep må konverteres/tolkes eksplisitt; de antas ikke automatisk å være klingende. Originalen omskrives aldri uten bevisst godkjenning.
- **[B]** Import må forstå kombinasjoner som `key: D`, `capo: 2`, `relative key: C`: D er klingende, C grepene ved capo 2. Forslag kan normaliseres til klingende akkorder med kontroll/godkjenning før lagring. Ulike eldre notasjoner må kartlegges.
- **[B]** Eldre akkordlinjer uten klammer, taktstreker `|` og rene akkordskjemaer hjelpes over til standard ChordPro. `{start_of_grid}`/`{end_of_grid}` brukes for rene skjemaer med taktstreker, repetisjon og transponering. Skjemaer er fullverdige sanger uten krav om å flette akkorder inn i tekst. Originalakkorder normaliseres klingende; personlig capo påvirker bare visningen.
- **[B]** Arbeidsflyten er åpne/importere eldre fil → forslag → kontroll/redigering → godkjenning → lagring. Appen bistår med opprydding; den krever ikke at filene ryddes manuelt først.
- **[B]** Alternativ gitarstemming og capo er personlige innstillinger per sang. Stemming er tekst og endrer ikke grep automatisk. Verdiene huskes per sang, også på tvers av setlister, og endres bare i «Rediger», aldri direkte i fremføringsvisningen eller på setlisteraden. Manglende toneart/akkorder skal ikke gi oppdiktet grepstoneart eller hindre øvrige tilpasninger.
- **[B]** Capo velges med `<` og `>` rundt et rent tall, uten tekstfelt. Bare heltall fra 0 til 11 er lovlige; knappene deaktiveres ved grensene uten å gå rundt. Treffområdene er minst 44 px; piltaster og Home/End gir tastaturalternativ. Capo 0 er standard, heter «Uten capo» i redigering og skjules under fremføring. Stemming uten avvik heter «Standard stemming».
- **[B]** Pillene viser toneart, takt, capo og stemming i denne rekkefølgen. Pillene er beskyttet i fremføring og den personlige visningen; de redigeres bare i originalmodalen innenfor #14-vernet. Takt leses fra originalens `{time: ...}` og vises i begge modi med 4/4 som standard; det er ikke personlige data.
- **[B]** Lokal endring mellom angitte tonearter via originaleditorens pille skal i #20 transponere inline-akkorder, alle felles grid og personlig skjema samlet én gang, med uendret capo/stemming. Ingen separat transponeringsknapp eller automatisk toneartsgjetting. Fremtidig ekstern filoppdatering skal ikke automatisk transponere personlig skjema eller spørre om dette; manuell korrigering aksepteres. Dette er en annen funksjon enn capo og er ikke implementert.
- **[TEKNISK]** Konkrete parseregler for eldre akkordlinjer/taktstreker/capo-grep og sikre usikkerhetstilfeller gjenstår til senere implementering.

### Felles og personlig akkordskjema

- **[B]** Sangen har én skjemavisning. Hvis et personlig/privat skjema finnes, brukes dette innholdet. Ellers brukes felles ChordPro-grid fra originalfilen. Finnes ingen av delene, vises ikke noe skjema. Personlig og felles skjema vises aldri samtidig. Opprettelse, redigering og fjerning av personlig skjema er implementert i den felles redigeringsmodusen og lagres lokalt, separat fra originalfilen. Brukeren kan starte fra felles skjema eller tomt grunnlag dersom felles skjema mangler. Ekstern App folder-lagring gjenstår.
- **[B]** Skjema redigeres som fri tekst med taktstreker i en bred popup uten rammetagger eller råvisning. Form, etiketter og flere gridblokker bevares. Overskriften følger valgt capo: «Akkordskjema» eller «Akkordskjema, capo N». Inndata er grepene som spilles med valgt capo; OK omregner til faktiske/klingende akkorder i utkastet. Eksempel: C med capo 2 lagres som D ved «Lagre» og vises igjen som C. Bekreftet endring av capo omregner både tekstakkorder og skjema umiddelbart i utkastet. Tomt bekreftet personlig skjema gir felles skjema tilbake dersom det finnes, ellers ingen skjemavisning. Ugyldig utkast erstatter ikke gyldig lagring.
- **[B]** Skjemaflaten kan fylle bredden, men taktene vises kompakt etter innholdets bredde. ChordPros punktum som separat element er en tom celle vist som luft, ikke nødvendigvis musikalsk pause. Hvert punktum gir én ekstra mellomromsbredde uten egen celleavstand, mens vanlig akkordavstand beholdes. Alle eksplisitte tomme celler bevares, uten firepunktumsgrense. Vanlige mellomrom angir ikke rytme. Det legges ikke til uspesifiserte tomme slag eller tomme startkolonner mellom takter. Eksplisitt shape bevares og antall takter per rad respekteres uten fylleceller.
- **[B]** Den samme skjemavisningen brukes uavhengig av innholdskilde. Den ligger kompakt under tittelen og fester seg under toppen ved scrolling i fremføringsvisningen. Under redigering scroller skjemaet med sangen uten sticky. Pin-knappen veksler sticky av/på i aktuell åpning. pin-on viser festet tilstand. Etter frigjøring vises pin-off fortsatt, og et nytt trykk fester skjemaet igjen. Den dempede pinnen er betjenbar, ikke deaktivert. Skjemaet beholder sin opprinnelige plass i dokumentet og kan finnes ved å scrolle opp. Neste åpning har sticky på igjen, i tråd med den generelle visningsinnstillingen.
- **[B]** For høyt sticky-skjema på liten skjerm vises automatisk kompakt fremfor med separat scrolling. Samlet komprimering og høydebegrensning er implementert; den konkrete utformingen står i [DESIGN](DESIGN.md#implementert-sangflyt). Fysisk plattformkontroll gjenstår.

## 5. Felles dynamikk i v1

- **[B]** Dynamikk er felles arrangementsinformasjon og visuell påminnelse for musikere som kjenner sangen, ikke eksakt tidslinje eller tradisjonell pp–ff-notasjon.
- **[B]** Fem nivåer 1–5, normalnivå 3. `{x_dyn: N}` lagres direkte i originalfilen. Ny tagg endrer nivå umiddelbart til neste tagg. I en sang med gyldige tagger brukes nivå 3 frem til første tagg; uten gyldige tagger vises ingen profil eller marg. Visuell innlegging og råtekstredigering inngår i den senere originaleditoren.
- **[B]** Én sammenhengende søyle i en fast 30 px venstremarg ved sangteksten, nedenfor tittel og akkordskjema. Venstrekanten er rett og fast; bare høyrekanten varierer inn mot teksten. Nivå 1–5 er henholdsvis 5/10/15/20/25 px brede, med myke lokale overganger og minst 5 px luft til teksten ved nivå 5. Marg og nivåbredder er uavhengige av tekststørrelsen; høyden følger sanginnholdet. Margen fjernes ved global av, manglende gyldige tagger eller skjermbredde under 320 px. Profilfargen skal ligge nær tekstfargen og være tydelig mot bakgrunnen i mørkt tema. Grafikken fremstiller ikke automatiske crescendoer, og tekstlinjer er ikke musikalsk varighet.
- **[B]** Ingen separat `.songbook`-annoteringsfil, personlig dynamikk eller `{dyn:...}` i v1. Avanserte ramper og frihåndstegning er utenfor v1.
- **[STATUS / DESIGN]** Parser, venstremargprofil og av/på er implementert med utforming beskrevet i [DESIGN](DESIGN.md#implementert-sangflyt). Nivåkontrollene i originaleditoren gjenstår å utforme og implementere. Fysisk lesbarhet/berøring gjenstår å verifisere.

## 6. Setlister og .setlist

### Bygging, redigering og navigasjon

- **[B]** Sanger velges på tvers av kilder, med én/flere kildefiltre. Setlisterader viser alltid tittel, klingende toneart og personlig capo/grep, samt relevante kommentarer. Alternativ stemming vises bare ved avvik fra standard.
- **[B]** Egen redigeringsmodus viser legg til/fjern/flytt-kontroller, med langt trykk/dra for rekkefølge. Vanlig bruk/fremføring skjuler dem for å hindre utilsiktede endringer. Ingen separat «Konsertmodus» i v1: manuell synk og eksplisitte redigeringsmodi gir vernet.
- **[B]** Nye sanger legges nederst i markeringsrekkefølgen, også ved flervalg i én operasjon, ikke alfabetisk. Deretter kan elementene flyttes fritt.
- **[B]** Ny tom setliste åpner direkte i redigering; eksisterende åpner vanlig visning. Alle endringer autospares. Ingen egen Lagre- eller Angre-knapp i setlisteeditoren.
- **[B]** Sangreferanse kan fjernes uten å slette sang/kildefil. Hele setlisten slettes fra oversikten etter eksplisitt bekreftelse, aldri med sletting av refererte sanger.
- **[B]** Pauser og fritekstpåminnelser har egne visuelt ulike rader og flyttes som sanger. Pauser kan ha valgfri varighet, eksempelvis 15 minutter; varighet er ikke obligatorisk.
- **[B]** Trykk åpner detalj-/fremføringsvisning; sidesveip følger neste/forrige element i setlisterekkefølge, også pauser/påminnelser. Sangvisning starter alltid øverst ved valg/sveip, også tilbake til tidligere åpnet sang. Scrollposisjon gjenopprettes ikke ved slik navigasjon. Ved en appoppdatering beholdes derimot den aktive appvisningen og posisjonen; det er ikke et nytt sangvalg.
- **[B]** Vanlig tilbake-navigasjon returnerer til setlisteoversikten med sist viste sang/element markert. Listen er ferdig posisjonert før visning uten synlig scrollanimasjon; elementet plasseres så nær vertikal midtstilling som naturlige listegrenser tillater. Ingen kunstig luft/overscroll for å sentrere første/siste rad. Ingen særskilt tilbake-til-setliste-knapp kreves.
- **[B]** Oversikten har nyeste setliste først og tillater manuell omorganisering. Automatisk gjenåpning av sist brukte setliste er ikke prioritert/krevd i v1; brukeren velger fra oversikten.

### Privat arbeidsversjon og publisering

- **[B]** Setlister kan opprettes, redigeres og lagres fullt offline. De beholdes lokalt og synkroniseres til privat App folder når nett finnes **og brukeren starter synk**. Publisering til felles Dropbox-mappe er separat fileksport/OS-deling, ikke direkte API-skriving.
- **[B]** Publisert setliste kan videre redigeres privat som arbeidsversjon. Privat lagring endrer ikke publisert `.setlist` før ny eksplisitt publisering. Synk overskriver ikke upubliserte endringer.
- **[B]** Samtidig endret publisert fil og privat arbeidsversjon gir samme konfliktflyt som sang: varsel, sammenligning og brukerbeslutning før erstatning; kan utsettes.
- **[B]** Duplisering gir ny selvstendig setlisteidentitet og gjenbruker sangreferanser uten å kopiere sanginnhold. Samme sangoppføring tillates bare én gang per setliste. Like titler fra ulike kilder er fortsatt ulike oppføringer.

### Transport, reserve og import – tre ulike situasjoner

- **[B] Transport:** `.setlist` er selvforsynt JSON med setliste, referanser og full tekst for alle sanger, delbar via e-post, Messenger, Dropbox osv. Publisert fil er et øyeblikksbilde av sangtekst ved publisering.
- **[B] Senere synk/manglende kilde:** bibliotekets/kildens nyeste tilgjengelige sangversjon er autoritativ. Innebygd tekst låser ikke til gammel versjon; den er reserve når kilde mangler. Ved slettet/utilgjengelig kilde beholdes reservekopien i aktuell setliste, merket «Kilde mangler», uten automatisk lokal sang i biblioteket. Brukeren kan velge lokal gjenoppretting/import. Ingen automatisk sletting av private data.
- **[B] Førstegangsimport:** gjenbruk sangoppføringer når mulig. Tilgjengelig, men ennå ikke synkronisert kilde gir tilbud om kildekobling/synk. Utilgjengelig kilde gir lokal import av sanginnhold uten kildesynk; dette kan eksporteres som fil. Appen antar ikke automatisk hvorfor en sang mangler. Denne importregelen er ikke samme situasjon som senere mistet kilde ovenfor.
- **[TEKNISK/TEST]** Setlister tilhører ikke nødvendigvis en kilde. ID-/innholdskonflikter, publiseringsfeil og referanseintegritet klargjøres senere etter disse reglene. Reell systemdeling fra iPad/Android må prøves før v1.

## 7. Identitet

- **[B]** Hver sang har stabil intern ID uavhengig av leverandør. Dropbox-fil-ID, kilde og relativ sti er ekstern identitet/oppslagsinformasjon. Lokale sanger får intern ID uten Dropbox. Ingen app-ID skrives inn i eksisterende ChordPro-filer.
- **[B]** Leverandørbytte eller gjenoppretting med ny Dropbox-ID skal ikke kreve ny domenemodell eller ødelegge identiteten.
- **[TEKNISK/TEST]** Fil-/kildeidentitet mellom kontoer, flytting og nyoppretting må verifiseres. Konkret matching og senere gjenkobling er senere arbeid som ikke skal utsette grunnleggende v1-flyt.

## 8. Dropbox, lokal bruk, synk og backup

### Tilgang og portabilitet

- **[B]** OAuth 2.0 med PKCE i frontend, ingen App secret. Dropbox-appen bruker **App folder**, ikke Full Dropbox. Scopes: `files.metadata.read`, `files.content.read`, `sharing.read`, `files.content.write`.
- **[B]** Domene-/produktlogikk og IndexedDB avhenger ikke direkte av Dropbox-API/-SDK. Ekstern lagring/synk ligger bak et avgrenset grensesnitt med én adapter (Dropbox), ikke generelt pluginrammeverk eller flere skyleverandører i v1. Leverandørbytte vil fortsatt kreve adapter/migrering for ulike ID-er, rettigheter og delingsmodeller.
- **[B]** Fullt lokalt bibliotek, redigering, annotering og setlister fungerer uten Dropbox-konto. Vanlig oppstart åpner direkte uten ny innlogging, også etter tidligere tilkobling. Offline krever ingen gyldig Dropbox-økt; autentisering skjer ved behov for Dropbox-handlinger.
- **[B]** Dropbox kan kobles til senere uten lokalt datatap. Førstegangstilkobling sammenligner lokale og skydata før sammenslåing: nye/identiske data håndteres trygt; avvik varsles og krever eksplisitt avgjørelse, aldri automatisk overskriving. Ny enhet kan hente kildeoppsett/private data ved første tilkobling, deretter synkes manuelt.
- **[B]** Frakobling beholder synkroniserte sanger/private data lokalt. Kilder merkes frakoblet og kan ikke synkes før ny tilkobling. Tilgangstoken og eventuelt refresh-token tilbakekalles, lagrede autentiseringsopplysninger fjernes fra enheten, og ny tilkobling krever ny OAuth-godkjenning. Uten Dropbox tilbys backup-påminnelse.
- **[B]** Delte lenker er **lesende** sangkilder. Privat App folder er les-/skrivbar for settings, kilderegistrering, private sanger, notater og setlister. Lokal vedvarende kopi trengs offline. Skriveretten brukes ikke til publisering i eksterne mapper.

### Manuell synk, konflikter og offline-klarhet

- **[B]** Synk startes alltid eksplisitt av brukeren, aldri ved oppstart eller når nett kommer tilbake. Én «Synkroniser»-knapp tar alle registrerte sangkilder og privat App folder; ingen enkeltkildesynk. Endringsdeteksjon begrenser unødige nedlastinger.
- **[B]** Feil i én kilde stopper ikke øvrige kilder; vellykkede/mislykkede operasjoner oppsummeres. Bekreftet sletting følger §2 og skilles fra midlertidig tilgangs-/synkfeil.
- **[B]** Mens brukeren er på nett, gis diskret synkpåminnelse ved lokale endringer som ennå ikke er synket til privat App folder, eller minst 30 dager siden sist vellykkede synk. Den forstyrrer ikke fremføring og starter ikke synk. Upubliserte arbeidsutkast til felles sanger/setlister skilles fra synkbare private endringer.
- **[B]** For hver setliste kontrolleres at nødvendig sanginnhold faktisk finnes lokalt og kan åpnes offline. Mangler varsles tydelig før fremføring; referanse alene gir ikke offline-klar status.
- **[TEKNISK/TEST]** Sikker tokenhåndtering, konflikter, synk mellom egne enheter og atomiske lokale oppdateringer ved synk klargjøres ved senere funksjonsimplementering. Personlig lagring i én lokal transaksjon er allerede implementert. IndexedDB/cache er ikke backup.

### Backup og manuell rekonstruksjon

- **[B]** Eksport/backup har sangfilene som hovedinnhold, gjenskapbare uten appen: alle tilgjengelige bibliotekssanger, både delte kilder og private, i åpne tekst-/ChordPro-formater med bevart kildeinndeling og opprinnelig relativ undermappestruktur for manuell tilbakeføring.
- **[B]** Backup inkluderer også personlige notater, gulmarkeringer, akkordskjemaer, capo-/stemmeinnstillinger og relevante appinnstillinger, lesbart/strukturert med identifikatorer og kildehenvisninger.
- **[B]** Én ZIP inneholder både separate lesbare sangfiler og komplett, versjonert JSON av sangene, kilde-/filmetadata og personlige data/innstillinger. Tilsiktet redundans: praktisk filtilbakeføring og samlet maskinlesbar rekonstruksjon. ZIP er bare backup/eksport, aldri Dropbox-synkformat.
- **[B]** Setlister er ikke prioriterte backupdata og må ikke tas med i komplett backup. Ingen omfattende intern restore/merge, automatisk ID-remapping eller krav om automatisk gjenoppretting av personlige koblinger i v1.
- **[B]** Ved ekstraordinært datatap gjennomgås backup utenfor appen, eventuelt med AI-hjelp. Sangfiler gjenskapes lokalt og legges manuelt tilbake i Dropbox, før ordinær synk leser dem inn. Personlig JSON hjelper manuell rekonstruksjon.
- **[TEKNISK]** Backup-manifest, identifikatorer og koblinger beskrives ved funksjonsimplementering, uten å innføre automatisk restore.

Historiske Dropbox-forsøk er bevart i [issue #1, del 3](https://github.com/geirskoglund/hobos-songbook/issues/1#issuecomment-6673681534). De er ikke verifikasjon av denne appens integrasjon eller sikkerhet.

## 9. Repo, miljøer og arbeidsmåte

**[B]** Public repo `geirskoglund/hobos-songbook`, standardbranch `master`. Produksjon er `https://geirskoglund.github.io/hobos-songbook/app/`, test `https://geirskoglund.github.io/hobos-songbook/test/`. To separate PWA-identiteter/scopes/cacher/lagringsnavn; én valgt implementerings-PR om gangen, ingen permanent testbranch. Dropbox-appidentiteter for senere arbeid bevares i [ARCHITECTURE](ARCHITECTURE.md#senere-ekstern-lagring).

**[B]** Selvstendige issues og korte agentinstruksjoner. Klargjøring supplerer bare aktuell issue, uten repoendringer. Implementerer lager branch, PR, testutgave og itererer på brukerens tilbakemelding. Koding krever uttrykkelig bestilling; merge krever uttrykkelig godkjenning etter relevant test. Relevant dokumentasjon oppdateres i samme bestilte PR.

**[B] Dokumentasjonsvedlikehold:** Både klargjørings- og implementeringsarbeid skal kontrollere gjeldende krav mot beslutninger, design og relevante godkjente issues/PR-er. Endrede produktbeslutninger innarbeides på riktig sted i eksisterende dokumentasjon; utdaterte/motstridende formuleringer erstattes eller fjernes. Nye beslutninger legges ikke ukritisk i presiseringsseksjoner på slutten. Bevar stabile ID-er og uendrede produktvalg. Dokumentene beskriver gjeldende tilstand og beslutninger med tydelig skille mellom vedtatt, planlagt, implementert og faktisk verifisert; historikk ligger i Git, issues og PR-er. Klargjøreren synliggjør dokumentasjonsbehov i issuen innenfor sin rolle; implementereren oppdaterer alle berørte dokumenter i leveransen og kontrollerer dem samlet for motstrid og unødvendig duplisering. Reelle produktspørsmål uten vedtatt løsning løftes til produktansvarlig.

Se [AGENTS](../AGENTS.md) og [TESTING](TESTING.md) for full rolle- og publiseringsflyt. Grønn CI er ikke produktgodkjenning.

## 10. Gjenstående før funksjonell v1

**[Å / DESIGN]** Administrasjon av sangbøker og eksterne kilder, setlister, originaleditorens musikalske verktøy/konvertering og nivåkontroller for dynamikk gjenstår å utforme. Originaleditorens grunnflate, sangvisning, sticky-høyde, dynamikkprofil og personlig redigering er utformet og implementert; de skal ikke omtales som ustartet designarbeid. Fysisk mobil-/nettbrettkontroll av lesbarhet, plassbruk, berøring og navigasjon gjenstår. Se [DESIGN](DESIGN.md#åpne-utformingsoppgaver).

**[TEKNISK]** Administrasjon av sangbøker og eksterne kilder, originaleditorens videre verktøy/konvertering, transponering av hele sangen, setlister, Dropbox-tilkobling, eksport/backup, skjermvåkenhet, full formatstøtte, ekstern identitetsmatching, konfliktsikker synk, `.setlist`-transport/publiseringsstatus og backup-manifest gjenstår. Codex velger implementeringsdetaljer innenfor vedtatte regler og løfter reelle produktmotstrid. Levert sangvisning og personlig redigering er del-leveranser; funksjonell v1 er ikke ferdig.

**[TEST]** Før v1 må rekursiv lesing fra eksterne delte mapper, fil-/kildeidentitet mellom Dropbox-kontoer, negativ tilgangstest, offline på iPad og systemdeling av `.setlist` til Dropbox fra mobil/nettbrett verifiseres. Se [TESTING](TESTING.md). Produktkravene er i hovedsak avklart; ingen nye serieintervjuer om hypotetiske unntak kreves.
