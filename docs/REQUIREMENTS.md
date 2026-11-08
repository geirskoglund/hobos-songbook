# Gjeldende krav

Dette er produktkrav, ikke en liste over ferdige funksjoner. **Implementert i denne kodebasen:** PWA-skall, offline-cache, miljøidentitet, oppdatering, CI/CD samt lokal UTF-8 ChordPro/TXT-innlesing, sanglagring, enkel oversikt og grunnleggende sangvisning med personlige refreng-/visningsvalg samt felles akkordskjema og femnivå-dynamikk fra issue #4 (inkludert F31–F33 og gjennomgått kompakt sangvisning). Personlige tilpasninger og felles redigeringsinngang fra issue #8 (F01–F42) er implementert; fysisk brukertest gjenstår. Øvrige v1-funksjoner nedenfor er vedtatt og gjenstår. Installert/fysisk test og publisering rapporteres separat i PR-en og [TESTING](TESTING.md).

Grunnlag er den daterte spesifikasjonen 5. november 2026 i [issue #1, del 1–4](https://github.com/geirskoglund/hobos-songbook/issues/1#issuecomment-6673680408) og avklaringene i samme issue. GitHub er autoritativ kilde etter oppstartsleveransen; Drive-originalen og de uendrede kommentarene er historisk kilde. Seksjonsnumrene følger originalen. **[B]** betyr besluttet, **[T]** historisk rapportert praktisk forsøk, **[Å]** uavklart, **[RETNING]** foretrukket designretning. Tekniske/designmessige vurderingspunkter er ikke testbevis eller godkjenning av en bestemt løsning.

## 1. Mål og bruk

- **[B]** Moderne sangbok primært for nettbrett under øving/konsert, også mobil og PC/Mac, både for band og privat på tvers av prosjekter. PC/Mac er særlig viktig for import/redigering. Uttrykket skal ikke oppleves som et gammeldags administrasjonsverktøy.
- **[B]** Offline-first PWA på statisk GitHub Pages, uten egen backend eller skydatabase. Appen skal kunne installeres og kjøre standalone der plattformen støtter det. Ingen separat fullskjerm-/skjul-nettleser-kontroll i v1; nettleserens UI-begrensninger gjelder ved vanlig nettleserbruk.
- **[B]** Manuell scrolling, ikke autoscroll. Nødvendig fremføringsinformasjon er synlig uten å åpne notater/menyer.
- **[B]** Når brukeren tar i bruk en ny appversjon, beholdes aktiv skjerm og posisjon generelt i hele appen, inkludert oversikt, sang og åpen innstillingsmeny. Oppdateringen skal ikke sende brukeren til førstesiden. Tilstanden gjelder aktuell fane og miljø.
- **[B]** Sangvisning og setliste holder som standard skjermen våken via støttet nettleserfunksjon. Brukeren kan slå dette av. Manglende plattformstøtte håndteres uten å love at dvale alltid kan hindres.
- **[B]** Skriftstørrelse i sangvisning justeres og huskes som personlig innstilling på tvers av sanger. Lys/mørk modus velges uavhengig av OS. Mørk er standard, dempet og scenediskret uten unødig lys/støy.

## 2. Domenemodell, bibliotek og sletting

- **[B] Kilde:** Dropbox-mappe registrert med delt lenke; mange egne og delte kilder støttes.
- **[B] Bibliotek:** samlet liste over kildesanger og private/lokale sanger. Én sammenhengende alfabetisk sangliste, filter på én/flere kilder. Ingen bokstavgruppering, fritekstsøk eller søkefelt i v1. Kildefilteret huskes, også «Alle sanger», og gjenopprettes ved neste oppstart.
- **[B] Sangrad:** tittel, klingende toneart og relevante kommentarer. Kildenavn vises ved behov, for eksempel ved like titler fra forskjellige kilder, ikke fast på alle rader.
- **[B] Sang:** selvstendig oppføring fra konkret kildefil eller privat opprettelse. Lik tittel i ulike kilder er ikke samme sang.
- **[B] Setliste:** ordnet samling av sangreferanser på tvers av kilder; også øvingsliste eller personlig repertoar. Internt dupliseres ikke sanginnholdet. Ingen separat «kontekst»/«samling» i domenemodellen.
- **[B] Personlig lag:** egne notater, markeringer, capo og akkordgrep er adskilt fra felles originalfil.

**[B] Konsoliderte sletteregler** (også original §8 og §10):

1. Sangfiler som finnes i Dropbox, også i brukerens private App folder, slettes utenfor appen. V1 har ingen «Fjern fra biblioteket» for å slette bare lokal synkronisert kopi eller frigjøre plass, og ingen separat brukeraktivert logisk sletting/skjuling.
2. Bekreftet fysisk sletting i kilden skjuler sangen fra ordinært bibliotek og vanlig sangvalg ved bygging av setlister. Lokal reservekopi beholdes, synlig og tydelig markert under «Vis slettede sanger». Tilgangs-/synkfeil er ikke bevis for sletting.
3. Reservekopien kan inspiseres, eksporteres som fil for manuell tilbakeføring og slettes permanent manuelt. Ingen automatisk opprydding, Dropbox-gjenoppretting eller «angre fysisk sletting» ved bare å endre status. «Vis slettede sanger» gjenoppretter ingen ekstern fil.
4. En sang som aldri har hatt ekstern kildefil og bare er opprettet/lagret lokalt, kan slettes i appen etter bekreftelse.
5. Fjerning av sangreferanse fra setliste eller sletting av hele setlisten sletter aldri sangen eller kildefilen. Se §6 for reserveinnhold når kilde senere mangler.

## Felles redigeringsprinsipp (issue #8 F01–F09, F41–F42)

Ordinær sangvisning er beskyttet fremføring. Scrolling, trykk og langt trykk åpner ingen redigeringskontroller. Refreng og frigjøring av skjema virker direkte. «Rediger» i toppmenyen eller sangradens meny åpner samme sang med kompakt verktøylinje og lokale verktøy. Etter produktansvarligs senere presisering lagres personlige endringer eksplisitt med «Lagre», som ikke avslutter redigeringen. Tilbake/«Avslutt redigering» returnerer til utgangspunktet; ved ulagret arbeid velges lagring, forkasting eller fortsatt redigering. Feil beholder utkastet. Denne modellen erstatter autosave/«Ferdig» i issue #8 F07–F08. Inngangen videreføres til fremtidig originalredigering, med tydelig skille mellom personlig lag og originalinnhold.

## 3. Sangformat, import og editor

- **[B]** Foretrukket format er ren tekst med ChordPro-kompatible direktiver, eksempelvis `{t:}`, `{title:}`, `{key:}`, `{soc}`, `{eoc}` og kommentarer. Akkorder i `[klammeparenteser]` støttes, men er ikke påkrevd.
- **[B]** Normal flyt er ekstern teksteditor, manuell filplassering i Dropbox og synk i appen. Appen tilbyr også opprettelse, redigering og konvertering i én felles editor. Eksport/lagring skjer via OS-filfunksjoner, også til en PC/Mac-mappe som Dropbox selv synkroniserer. Offline-utkast mellomlagres lokalt.
- **[B]** Editor starter formatert med visuelle direktiver, og kan veksle til full råtekst. Markert tekst/avsnitt får relevante ChordPro-valg som Refreng, Kommentar og Dynamikk i kontekstmeny fremfor permanent verktøylinje. PC/Mac har god støtte for tastatur, markering og effektiv tekstredigering, ikke bare et mobilgrensesnitt.
- **[B]** Import av TXT/ChordPro, Word og PDF forsøker automatisk å finne vers, refreng, kommentarer og øvrig struktur og foreslår tagger. Forslaget er redigerbart og må gjennomgås/godkjennes før lagring. Sangtekstens ordlyd omskrives ikke automatisk. Regelbaserte forslag krever ingen innebygd AI-tjeneste.
- **[B]** Bare maskinlesbar tekst importeres i v1. Ingen OCR, skannede PDF-er eller bilder; ekstern AI/OCR kan brukes først ved behov. Konvertering skjer én sang om gangen, ingen batchkonvertering.
- **[B]** Undo/Redo har én felles historikk mellom formatert og rå modus. Autosave nullstiller ikke historikken. Historikken gjelder den åpne redigeringsøkten og kan nullstilles ved lukking. Publisering er separat fra Undo og versjonshåndtering.

### Arbeidskopi, publisering og konflikt

- **[B]** Redigering av sang fra delt Dropbox-kilde oppretter automatisk privat arbeidskopi. «Rediger» åpner direkte; endringer lagres fortløpende. «Ferdig» viser redigert versjon med diskret markering av upubliserte endringer. «Publiser» er separat. Denne v1-modellen prøves og vurderes ved brukertest.
- **[B]** Kilden endres ikke før brukeren eksplisitt eksporterer/publiserer via OS/Dropbox utenfor lesebasert kildesynk. Synk overskriver ikke upubliserte arbeidskopier.
- **[B]** Dersom originalen er endret etter opprettelse av arbeidskopien, varsles konflikt med sammenligning av opprinnelig kilde, oppdatert kilde og arbeidskopi. Ingen versjon overskrives automatisk. Brukeren bestemmer og kan utsette håndtering.

### Refreng og eldre markører

- **[B]** Første `{soc}…{eoc}` viser hele teksten med overskriften «Refreng» og kan ikke foldes. Senere `{chorus}`-henvisninger har samme overskrift og åpnes/lukkes individuelt ved direkte trykk. Personlig tilstand lagres per forekomst og gjenopprettes ved neste åpning; nye gjentakelser starter sammenfoldet. Ingen separat kort/utvidet-innstilling. Originalfilen endres ikke.
- **[B]** Import foreslår `[Solo]`/`[Fele]` som `{comment: Solo}`/`{comment: Fele}`. Gjentatt `[Ref]` foreslås som `{chorus}` bare når et tidligere refreng er definert, ellers som `{comment: Refreng}`. Eldre markører skal ikke automatisk tolkes som akkorder bare fordi de bruker klammer.
- **[TEKNISK]** Parser, konverteringsregler og håndtering av tvetydighet klargjøres ved senere implementering. Manuell kontroll og godkjenning før lagring gjelder også normalisering.

## 4. Sangvisning, personlige notater og capo

### Notater, gulmarkering og forankring

- **[B]** Trykk på en sang åpner lesbar sangvisning. Personlige notater/markeringer er umiddelbart lesbare mens man spiller, uten ekstra interaksjon, og endrer ikke felles sangfil.
- **[B]** Korte, konsise notater er normal bruk; visning/editor prioriterer korte instrukser uten krav om nøyaktig én linje. Opprettelse/redigering skjer i den felles modusen «Rediger»; vanlig sangvisning skal ikke lage notater ved utilsiktet berøring.
- **[B]** Selektiv personlig gulmarkering gjelder vilkårlige ord/tekstspenn innen én linje, eller hele linjen, eksempelvis egne korord. Endres i den felles redigeringsmodusen. Ingen egen vertikal strek eller frihåndstegning i v1.
- **[B]** Notater forankres til en bestemt logisk linjeforekomst, ikke bare tekstinnhold, slik at gjentatte refrenglinjer skilles. Automatisk linjebryting på ulike bredder tåles.
- **[B]** Ved tekstoppdatering forsøkes gjenforankring fra posisjon, tekst og omkringliggende kontekst. Usikker matching varsles med gammel tekst, tilhørende annotering og foreslått ny plassering. Brukeren kan godkjenne, omplassere, forkaste eller utsette. Ingen automatisk sletting eller permanent flytting av usikre annoteringer, og ingen tvungen avklaring rett før fremføring.
- **[B]** Nyeste synkroniserte tekst er standard; sikre annoteringer følger med. Usikre bevares uten ny tekstplassering, med diskret varsel og sammenligning mot gammel kontekst. Tidligere tekst med annoteringer er tilgjengelig for gjenoppretting/gjennomgang.
- **[RETNING]** Notater vises helst på høyre side, også som overlegg der det utnytter plassen bedre. Halvgjennomsiktig bakgrunn lar underliggende tekst skimtes. Eksakt kontrast, transparens og plassering avgjøres i skisser/testing, ikke ved en generell begrensning mot overlapp.
- **[Å / TEKNISK/DESIGN]** Gjenforankringsalgoritme, minimum av lagret versjonskontekst og mobilutforming gjenstår. Å beholde sist gjennomgått fremføringsversjon rett før konsert er et senere vurderingspunkt.

### Klingende toneart, capo, stemming og eldre filer

- **[B]** `{key: ...}` er klingende toneart, uavhengig av personlig capo. I sangvisningen vises verdien alene i en diskret pille uten ledetekst. En egen pille ved siden av viser for eksempel «Capo 7: Am». Capo skrives ikke i felles sangfil. Klingende toneart og personlig capo-/grepstoneart er synlige samtidig, også på setlisteraden, slik at musikere kan kommunisere riktig toneart.
- **[B]** Personlig capo bestemmer visningen av både tekstakkorder og akkordskjema, samt innskriving i personlig skjema. Separat akkordvisningsvalg er fjernet etter produktansvarligs presisering. Dette endrer ikke originalakkorder eller sangens toneart.
- **[B]** Nye filer tolkes som klingende akkorder som standard. Eldre filer med noterte capo-grep må konverteres/tolkes eksplisitt; de antas ikke automatisk å være klingende. Originalen omskrives aldri uten bevisst godkjenning.
- **[B]** Import må forstå kombinasjoner som `key: D`, `capo: 2`, `relative key: C`: D er klingende, C grepene ved capo 2. Forslag kan normaliseres til klingende akkorder med kontroll/godkjenning før lagring. Ulike eldre notasjoner må kartlegges.
- **[B]** Eldre akkordlinjer uten klammer, taktstreker `|` og rene akkordskjemaer hjelpes over til standard ChordPro. `{start_of_grid}`/`{end_of_grid}` brukes for rene skjemaer med taktstreker, repetisjon og transponering. Skjemaer er fullverdige sanger uten krav om å flette akkorder inn i tekst. Originalakkorder normaliseres klingende; personlig capo påvirker bare visningen.
- **[B]** Arbeidsflyten er åpne/importere eldre fil → forslag → kontroll/redigering → godkjenning → lagring. Appen bistår med opprydding; den krever ikke at filene ryddes manuelt først.
- **[B]** Alternativ gitarstemming og capo er personlige innstillinger per sang. Stemming er tekst og endrer ikke grep automatisk. Capo gjelder på tvers av setlister og endres fra lett tilgjengelige sanginnstillinger, ikke på raden.
- **[TEKNISK]** Konkrete parseregler for eldre akkordlinjer/taktstreker/capo-grep og sikre usikkerhetstilfeller gjenstår til senere implementering.

### Felles og personlig akkordskjema

- **[B]** Sangen har én skjemavisning. Hvis et personlig/privat skjema finnes, brukes dette innholdet. Ellers brukes felles ChordPro-grid fra originalfilen. Finnes ingen av delene, vises ikke noe skjema. Personlig og felles skjema vises aldri samtidig. Personlig innhold lagres separat fra originalfilen; ekstern App folder-lagring og redigering kommer i egne leveranser.
- **[B]** Den samme skjemavisningen brukes uavhengig av innholdskilde. Den ligger kompakt under tittelen og fester seg under toppen ved scrolling i fremføringsvisningen. Under redigering scroller skjemaet med sangen uten sticky. × slår bare av sticky i aktuell åpning. Skjemaet blir stående på sin opprinnelige plass i siden og kan leses ved å scrolle opp. Neste åpning har sticky på igjen, i tråd med den generelle visningsinnstillingen.
- **[B]** For høyt sticky-skjema på liten skjerm vises automatisk kompakt fremfor med separat scrolling. **[Å / DESIGN]** Kompakt utforming og maksimal høyde avgjøres i nettbrett-/mobilskisser.

## 5. Felles dynamikk i v1

- **[B]** Dynamikk er felles arrangementsinformasjon og visuell påminnelse for musikere som kjenner sangen, ikke eksakt tidslinje eller tradisjonell pp–ff-notasjon.
- **[B]** Fem nivåer 1–5, normalnivå 3. `{x_dyn: N}` lagres direkte i originalfilen. Ny tagg endrer nivå umiddelbart til neste tagg; ingen tagg betyr 3. Innlegging støttes visuelt og i råtekst.
- **[B]** Én sammenhengende, smal og symmetrisk søyle bak sangteksten, med myke lokale breddeoverganger. Også nivå 5 er smalt og betyr ikke full skjermbredde; bredden viser intensitet, og visning kan slås av/på. Avrundede kanter er tillatt, men grafikken fremstiller ikke automatiske crescendoer. Antall tekstlinjer er ikke musikalsk varighet.
- **[B]** Ingen separat `.songbook`-annoteringsfil, personlig dynamikk eller `{dyn:...}` i v1. Tidligere forslag om utsettelse til fase 2 gjelder ikke. Avanserte ramper og frihåndstegning er utenfor v1.
- **[Å / DESIGN]** Kontrollene for nivå og den konkrete midtstilte profilen prøves i skisser. Originalens merking «DESIGN/FASE 2» gjelder dette utformingsarbeidet, ikke en utsettelse av den vedtatte v1-funksjonen.

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
- **[TEKNISK/TEST]** Sikker tokenhåndtering, konflikter, synk mellom egne enheter og atomiske lokale oppdateringer klargjøres ved senere funksjonsimplementering. IndexedDB/cache er ikke backup.

### Backup og manuell rekonstruksjon

- **[B]** Eksport/backup har sangfilene som hovedinnhold, gjenskapbare uten appen: alle tilgjengelige bibliotekssanger, både delte kilder og private, i åpne tekst-/ChordPro-formater med bevart kildeinndeling og opprinnelig relativ undermappestruktur for manuell tilbakeføring.
- **[B]** Backup inkluderer også personlige notater, gulmarkeringer, akkordskjemaer, capo-/stemmeinnstillinger og relevante appinnstillinger, lesbart/strukturert med identifikatorer og kildehenvisninger. Dette presiserer originalens tidligere formulering om at innstillinger «kan» inngå.
- **[B]** Én ZIP inneholder både separate lesbare sangfiler og komplett, versjonert JSON av sangene, kilde-/filmetadata og personlige data/innstillinger. Tilsiktet redundans: praktisk filtilbakeføring og samlet maskinlesbar rekonstruksjon. ZIP er bare backup/eksport, aldri Dropbox-synkformat.
- **[B]** Setlister er ikke prioriterte backupdata og må ikke tas med i komplett backup. Ingen omfattende intern restore/merge, automatisk ID-remapping eller krav om automatisk gjenoppretting av personlige koblinger i v1.
- **[B]** Ved ekstraordinært datatap gjennomgås backup utenfor appen, eventuelt med AI-hjelp. Sangfiler gjenskapes lokalt og legges manuelt tilbake i Dropbox, før ordinær synk leser dem inn. Personlig JSON hjelper manuell rekonstruksjon.
- **[TEKNISK]** Backup-manifest, identifikatorer og koblinger beskrives ved funksjonsimplementering, uten å innføre automatisk restore.

### Historisk rapportert funksjonsforsøk, ikke appverifikasjon

**[T]** Originalen rapporterte fungerende App folder OAuth/PKCE uten backend; ekstern lenke listet først 7, senere 8 filer; lydfil og ChordPro-tekst kunne lastes ned. Privat App folder listet 212 filer og 4 undermapper. Unik testfil ble lastet opp, nedlastet med identisk innhold og slettet. Dette er historiske forsøk fra før denne kodebasen, **ikke** tester av Hobo's Songbook eller full sikkerhetsgodkjenning. Delt lenke gir bare tilgang som lenken tillater; ingen generell Full Dropbox-tilgang behøves.

## 9. Repo, miljøer og arbeidsmåte

**[B]** Public repo `geirskoglund/hobos-songbook`, standardbranch `master`. Produksjon er `https://geirskoglund.github.io/hobos-songbook/app/`, test `https://geirskoglund.github.io/hobos-songbook/test/`. To separate PWA-identiteter/scopes/cacher/lagringsnavn; én valgt implementerings-PR om gangen, ingen permanent testbranch. Dropbox-appidentiteter for senere arbeid bevares i [ARCHITECTURE](ARCHITECTURE.md#senere-ekstern-lagring).

**[B]** Selvstendige issues og korte agentinstruksjoner. Klargjøring supplerer bare aktuell issue, uten repoendringer. Implementerer lager branch, PR, testutgave og itererer på brukerens tilbakemelding. Koding krever uttrykkelig bestilling; merge krever uttrykkelig godkjenning etter relevant test. Relevant dokumentasjon oppdateres i samme bestilte PR. Se [AGENTS](../AGENTS.md) og [TESTING](TESTING.md) for full rolle- og publiseringsflyt. Grønn CI er ikke produktgodkjenning.

## 10. Gjenstående før funksjonell v1

**[Å / DESIGN]** Skisser og eierens vurdering av bibliotek, sangvisning med notater/akkordskjema/dynamikk, setlister, redigeringsmodi og mobiltilpasning gjenstår. Prøv plass, lesbarhet, berøring og navigasjon uten å gjenåpne avklarte domeneregler.

**[TEKNISK]** Full format-/konverteringsstøtte, gjenforankring ved ny originaltekst, ekstern identitetsmatching, konfliktsikker synk, `.setlist`-transport/publiseringsstatus og backup-manifest gjenstår. Codex velger implementeringsdetaljer innenfor vedtatte regler og løfter reelle produktmotstrid. PWA-skallet og CI/CD er oppstartsleveransen, ikke funksjonell v1.

**[TEST]** Før v1 må rekursiv lesing fra eksterne delte mapper, fil-/kildeidentitet mellom Dropbox-kontoer, negativ tilgangstest, offline på iPad og systemdeling av `.setlist` til Dropbox fra mobil/nettbrett verifiseres. Se [TESTING](TESTING.md). Produktkravene er i hovedsak avklart; ingen nye serieintervjuer om hypotetiske unntak kreves.

Ved ny beslutning endres berørt krav på plass; motstrid erstattes fremfor å akkumuleres. Historikk ligger i Git/issues/PR-er, mens vesentlige begrunnelser bevares i [DECISIONS](DECISIONS.md). Praktiske tester merkes utført først når de faktisk er gjennomført.


### Presisering av personlig skjema og capo

Capo 0 er standard, heter «Uten capo» i redigering og skjules under fremføring. Stemming uten avvik heter «Standard stemming». Pillene viser toneart, taktart, capo og stemming i denne rekkefølgen. Taktart leses fra originalens `{time: ...}` og vises uredigerbart i begge modi, med 4/4 som standard; det er ikke personlige data.

Skjema redigeres som fri tekst med taktstreker i en bred popup uten rammetagger eller råvisning. Overskriften følger valgt capo: «Akkordskjema» eller «Akkordskjema, capo N». C med capo 2 blir D i utkastets faktiske akkordrepresentasjon ved OK, og vises igjen som C. Endret capo omregner både skjema og tekstakkorder umiddelbart. Tomt bekreftet skjema gir felles skjema tilbake, ellers ingen skjemavisning. Skjemaflaten kan fylle bredden, men musikalsk innhold vises kompakt.

Ikonverktøylinjen har Lagre til venstre, deretter markeringspenn, notat og skjema. Lagre er aktiv bare ved bekreftede endringer siden sist lagring. Native tekstvalg bruker verktøylinjen uten ekstra app-popup. Valgt gulmarkering har × og direkte endehåndtak. Notat opprettes fra levende tekstvalg eller et uttrykkelig plasseringsvalg, også i marg/tomme linjer; × på notatet sletter. OK bekrefter popupens utkast og lukker; Avbryt/Escape/utvendig trykk forkaster uten spørsmål. Bare Lagre skriver vedvarende. Disse presiseringene erstatter issue #8 F07–F08 og det separate visningsvalget i F13/F15. F22s sticky gjelder fremføringsmodus.

Senere transponering av hele sangen skal flytte alle lagrede akkorder, inkludert personlige skjemaer; selve toneartsendringen inngår ikke i issue #8.
