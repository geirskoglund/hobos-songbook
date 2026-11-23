# Produktkrav

Gjeldende produktregler for Hobo's Songbook. Alle regler her er vedtatt. Det som ennå ikke er bygget, står samlet i §9. Begrunnelser står i [DECISIONS](DECISIONS.md), teknisk oppbygning i [ARCHITECTURE](ARCHITECTURE.md) og utforming i [DESIGN](DESIGN.md). Begrepene følger [GLOSSARY](../GLOSSARY.md).

## 1. Mål og bruk

- Moderne sangbok for øving og konsert, først og fremst på nettbrett, men også på mobil og PC/Mac. Den brukes både i band og privat, på tvers av prosjekter. PC/Mac er særlig viktig for import og redigering og skal ha god støtte for tastatur, markering og tekstredigering. Appen skal ikke føles som et gammeldags administrasjonsverktøy.
- Offline-first PWA på GitHub Pages, uten egen backend eller skydatabase. Appen kan installeres og kjøre frittstående der plattformen støtter det. Ingen egen fullskjermkontroll; vanlig nettleserbruk har nettleserens begrensninger.
- Manuell scrolling, ingen autoscroll. Det man trenger under fremføring, er synlig uten å åpne notater eller menyer.
- Når brukeren tar i bruk en ny appversjon, kommer hen tilbake til samme skjerm og posisjon: oversikt, sang, åpen hovedmeny eller Innstillinger. Dette gjelder aktuell fane og kanal.
- Skriftstørrelsen i sangvisning justeres og huskes på tvers av sanger.
- Fast mørkt Organisk-tema uavhengig av operativsystemet. Ingen lysmodus eller temavelger. En eldre lagret lysmodus normaliseres uten å røre andre innstillinger.
- Appen styrer tekst- og kontekstbetjening på alle skjermer, også i skrivefelt. Nettleserens tekst- og lenkemenyer, native verktøytips og valideringsballonger erstattes av appens egne. Merk alt, klipp ut, kopier, lim inn, angre og vanlig skriving virker fortsatt. Innliming bruker eksisterende tilgang til utklippstavlen eller tastaturet, uten ny tilgangsforespørsel. Korte trykk og scrolling i et felt beholder vanlig betjening. Nettleserens hovedmeny og OS-funksjoner som filvalg og skjermtastatur er utenfor appens kontroll. Se [DESIGN](DESIGN.md#felles-interaksjonsprinsipp).
- Hovedmenyen er et sidepanel til høyre under headeren, åpnet med hamburgeren. Rekkefølgen er Sanger, Setlister, Synkronisering, Sangbøker, Publisering (bare med konfigurert Dropbox-tilkobling) og Innstillinger nederst. Innstillinger er en egen side.
- Dialoger bruker felles ramme og footer for én, to eller tre handlinger. Hver kontrolltype finnes én gang og brukes fra flere steder. Overordnet layout vedlikeholdes ett sted.

## 2. Bibliotek, sangbøker og sletting

### Begreper

- **Sang:** selvstendig oppføring fra en konkret kildefil eller opprettet i appen. Lik tittel i ulike kilder gjør ikke to sanger til én.
- **Sangbok:** egen entitet med navn og stabil ID. Hver sang tilhører nøyaktig én sangbok. Sangbok er noe annet enn kilde og setliste.
- **Setliste:** ordnet samling av sangreferanser på tvers av kilder, også som øvingsliste eller repertoar. Sanginnholdet dupliseres ikke.
- **Personlig lag:** notater, gulmarkeringer, capo, stemming og personlig akkordskjema, lagret adskilt fra originalen.
- **Kilde:** Dropbox-mappe registrert med delt lenke. Mange egne og delte kilder skal støttes (§9).

### Sangbøker

- Standard opprettes én gang ved første oppsett. Gamle sanger uten sangbok flyttes dit uten datatap. Deretter er Standard en vanlig bok: navneendring beholder ID og tilordninger, sletting følger samme regler som andre bøker, og vanlig oppstart gjenoppretter den aldri.
- Sangbøker-siden viser bøkene alfabetisk med navn og antall sanger (L02). Kontekstmenyen har Endre navn, Slett og, med Dropbox-tilkobling, Kopier delingslenke. H01 oppretter ny bok. Trykk på en rad åpner Sanger filtrert på boken.
- **Navn** er obligatorisk og unikt uten hensyn til store og små bokstaver. Mellomrom først og sist fjernes, og Unicode normaliseres. Tegnene / \ < > : " | ? \* er ikke tillatt, og navnet kan ikke ende med punktum. CON, PRN, AUX, NUL, COM1–COM9 og LPT1–LPT9 avvises, også med filendelse. Ved navneendring teller ikke bokens eget navn. Samme validering gjelder i UI og i lagringstransaksjonen.

### Sanglisten

- Forsiden Sanger er én alfabetisk liste. Et midtstilt filter viser Alle eller én sangbok. Valget huskes på tvers av sider og oppstart, per kanal, og deles med Publisering. Alle er et filter, ikke en bok. Et ugyldig lagret valg gir Alle.
- Sangbokvelgeren viser Alle øverst og deretter bøkene alfabetisk, uten opprettelseshandling.
- Ingen bokstavgruppering, fritekstsøk eller søkefelt.
- Sangraden viser tittel og metadata i rekkefølgen faktisk toneart, takt (4/4 når den mangler), capo med grepstoneart og alternativ stemming. Capo 0 og standard stemming vises ikke. Uten toneart vises ingen grepstoneart. Metadata brytes på smale skjermer.
- Trykk på raden åpner sangvisning. Raden har ingen meny; Rediger ligger i sangvisningens header.

### Sletting

1. Sangfiler som ligger i Dropbox, også i brukerens private app-mappe, slettes utenfor appen. Appen har ingen «Fjern fra biblioteket», ingen skjuling og ingen «Vis slettede sanger».
2. **Privat app-mappe:** Dropbox er master. Ved manuell Synkroniser fjernes en bekreftet slettet, kjent privat sangfil fra appen sammen med det personlige laget. Bekreftet sletting av en kjent sangbokmappe, eller flytting av den ut av `Songbooks`, fjerner boken og alle dens sanger lokalt, også sanger som aldri er lastet opp. Slettingen vinner over lokale endringer som ikke er lastet opp; de lastes ikke opp og gjenoppretter ikke noe.
3. Appen beholder ingen reservekopi av slettet innhold, bare den interne identiteten som trengs for å hindre gjenoppretting. Tilgangsfeil, nettverksfeil, ufullstendig mappeoversikt eller manglende metadata er aldri bevis for sletting. Sletteregler for andres delte mapper er ikke avklart.
4. En sang som flyttes mellom Private og Shared, beholder identitet, original, personlig lag og referanser. En sang som flyttes til Originals, fjernes fra appen, men filen i Originals blir liggende. En sang som allerede er flyttet til en aktiv bok, skal ikke slettes fordi en annen enhet fortsatt ser den gamle boken.
5. En sang som bare finnes lokalt og aldri har hatt ekstern kildefil, kan slettes i appen etter bekreftelse.
6. **Slett sangbok lokalt:** minst én bok må finnes. En tom bok kan slettes uten mål. En bok med sanger krever en annen eksisterende eller ny målbok, valgt i samme D10-dialog med sangbokikonet i headeren. Avbryt har startfokus. Med Dropbox-tilkobling forklarer bekreftelsen at sangene blir private.
7. Før overføringen sjekkes målboken for sanger med nøyaktig samme filnavn med endelse. Appopprettede sanger bruker kjent filnavn, ellers tittel med `.cho`. Et tomt filnavn gir aldri treff. Hvert treff avklares med E03 Avbryt / Behold begge. Avbryt stopper hele slettingen før noe endres. Behold begge endrer ingen sangidentitet.
8. Slett kontrollerer på nytt at boken ikke er den siste, hvilke sanger den har og duplikatene, og flytter så sangene og fjerner boken i én transaksjon. Ved feil rulles alt tilbake. ID, original, personlig lag og setlister beholdes. Var den slettede boken aktivt filter, blir filteret Alle. En ny bok som allerede er lagret fra navnedialogen, beholdes selv om slettingen avbrytes.
9. Med Dropbox flyttes de berørte `.cho`-filene fra Private eller Shared til målbokens Private, med varig fremdrift ved avbrudd. Først når alle sangene er bekreftet i målboken, flyttes hele den gamle bokmappen med Originals og andre rester til `/Deleted/[Sangboknavn] YYYY-MM-DD HHmm/`. Tidspunkt og mål lagres én gang; en ekte navnekollisjon gir `(2)` osv. Mappen slettes aldri.
10. En ny bok med samme navn som en slettet bok får ny ID og ny mappe. En annen enhet henter den ved neste manuelle synk uten navnekonflikt, mens flyttede sanger og personlige lag blir i målboken. Sletting og gjenbruk av navnet før enheten er på nett igjen skal kunne fullføres uten å låse seg, også når den nye boken er målbok eller en eksisterende målmappe overtar navnet. En påbegynt sletting av en tom mappe kan måtte gjenopptas ved neste synk.
11. Fjerning av en sang fra en setliste, eller sletting av hele setlisten, sletter aldri sangen eller kildefilen.

## 3. Sangformat, import og redigering

### Format

- Ren tekst med ChordPro-direktiver som `{t:}`, `{title:}`, `{key:}`, `{soc}`, `{eoc}` og kommentarer. Akkorder i `[klammer]` støttes, men er ikke påkrevd.
- Vanlig arbeidsflyt er ekstern teksteditor, manuell plassering i Dropbox og synk i appen. Appen kan også opprette, redigere og konvertere sanger i én felles editor, og det virker offline.
- Ingen app-ID eller personlig lag skrives inn i en ChordPro-fil.

### Sangvisning og redigering

- Vanlig sangvisning er beskyttet fremføring. Berøring, scrolling og langt trykk åpner ingen redigering og endrer ikke personlige tilpasninger. Refrengfolding og sticky-skjema av/på virker direkte og er ikke redigering.
- Headeren veksler mellom Rediger (blyant) og Visning (øye) på samme sangflate, og lesestedet beholdes. Tilbake forlater sangen.
- Sangordene er låst utenfor Råtekst. Filinnhold og Egentilpasning har hvert sitt sett verktøy, med felles Angre, Gjør om og Fjern først. Ikonene har tekst under, verktøyene brytes fra venstre, og verktøylinjen står fast med samme høyde i begge faner.
- Gyldige verktøyendringer autospares lokalt; sangflaten har ingen Lagre-knapp. En endring i original og tilhørende personlig lag regnes som lagret først når én samlet transaksjon er fullført. Lagringene går i en kø. Ved feil beholdes arbeidet og kan prøves igjen, uten falsk lagret-status.
- D07 og D08 er små direkte verdikontroller uten OK/Avbryt. Tekstfeltene har én linje og ingen størrelseshåndtak. De åpnes ved trykkstedet eller like under verktøylinjen, tilpasset skjermen. Ett besøk er ett angresteg. Ugyldig inntasting erstatter ikke siste gyldige verdi, og trykk utenfor eller Escape lukker med den gyldige verdien beholdt. En tom akkord sendt inn uttrykkelig fjerner klammen. Større skjemaer har Avbryt/OK. Kontroller aktiveres ved fullført trykk, ikke ved avbrudd, scroll eller drag.
- Verktøy velges før plassering. Langt trykk velger ett eksisterende element med omriss; videre drag flytter notater og inline-akkorder. Fjern sletter bare det valgte og er deaktivert uten valg. Ingen slettekryss eller slettemodus. Valget beholdes etter flytting og fanebytte og oppheves ved trykk utenfor eller valg av annet verktøy. Enter eller mellomrom velger fokusert element; Delete fjerner.
- Akkorder, anvisninger, dynamikk, refrengformatering og -henvisning, notater og gulmarkeringer kan fjernes. Sangordene under refreng og gulmarkering blir stående. Begge akkordskjemaene tømmes i sin egen kontroll.
- Historikken er felles for original og personlig lag. Den gjelder til sangen forlates, også gjennom fane- og modusbytte, lagring og besøk i Innstillinger. Angre og Gjør om autospares. Folding og scroll er ikke angresteg.
- Utgang og appoppdatering venter på lagringskøen. Ubekreftet Råtekst, ugyldige felt og lagringsfeil beskyttes mot tap. Autospart arbeid gir ingen lagre/forkast-dialog.
- Én sangøkt eier original, personlig lag, historikk og lagret grunnlag. Råtekst og skjemakontroller har egne midlertidige felt til de bekreftes. Ingen versjonshistorikk for sanger.
- Akkorder settes på eksakt tekstposisjon, også midt i ord. Inline-akkorder kan flyttes uten å endre sangordene; på berøring vises en forstørret forhåndsvisning over fingeren.
- Refreng velges på hele logiske linjer og justeres med endehåndtak. En henvisning gjentar nærmeste tidligere refreng. Uten tidligere refreng vises bare «Refreng»; taggen kan da brukes over egen refrengtekst.
- Verktøyene endrer bare avgrensede deler av kilden og bevarer uberørt whitespace, BOM, linjeskift og taggenes stavemåte. Tittelendring oppdaterer alle t/title-tagger. Taktpillen og verktøyet bruker første time-tagg; senere taktangivelser blir stående. Flertydig toneart rettes i Råtekst.
- Innsetting etter siste tekstlinje kan legge til én kompakt blanklinje, men ikke når det allerede er luft der.

### Opprett og Importer

- Opprett og Importer ligger i plussmenyen på Sanger. Begge åpner først én D10-dialog («Opprett i sangbok» / «Importer i sangbok») med sangbokikon og E03 Avbryt/Fortsett. Valglisten åpnes i samme dialog.
- En gyldig sangbok kreves; Alle er ikke et mål. Forslaget er den eneste boken hvis det bare finnes én. Ellers foreslås sist brukte bok ved vellykket lagring i samme appøkt (felles for Opprett og Importer), deretter aktivt filter, ellers ingen. Forslaget kan endres.
- En ny bok fra navnedialogen lagres med en gang, blir valgt og beholdes selv om brukeren avbryter senere. Avbryt i navnedialogen beholder forrige valg.
- Valg av mål endrer ikke filteret. Først en vellykket opprettelse eller import setter og husker filteret til målboken. Avbrudd og feil beholder forrige filter.
- Målboken kontrolleres ved lagring. Er den borte, må brukeren velge på nytt, og utkastet eller filinnholdet beholdes. Ingen skjult reserve til Standard.
- **Opprett** åpner Råtekst med `{t: }` og markøren i tittelen. Tittel kreves; tom sangtekst er lov. Avbryt første gang etterlater ingenting. Første vellykkede Lagre oppretter sangen med stabil ID og viser sangredigeringen. Ved feil beholdes råteksten uten dublett.
- **Importer** åpner systemets filvalg for én støttet UTF-8-tekstfil. Etter import vises Sanger filtrert på målboken; sangen åpnes ikke automatisk. Automatisk opplasting kan starte når importen er ferdig. Avbrudd eller feil etterlater ingen sang.
- Har biblioteket allerede en sang med samme filnavn og endelse, på tvers av bøker, spør appen: «Fil [filnavn.filendelse] er allerede importert. Vil du importere en kopi?» med Avbryt og Importer. Importer gir ny sang-ID. Innholdet brukes ikke i dublettkontrollen.
- Nye filnavn er importens basisnavn eller sangens tittel, med `.cho`, uten interne nøkler.

### Råtekst

- Fullskjerm med tittelen «Råtekst», hele ChordPro-kilden med faktiske akkorder, egen scroll og Avbryt/Lagre. Avbryt forkaster bare denne redigeringen og kan ikke hentes tilbake med Gjør om. Lagre skriver original og justerte ankre samlet.
- Ukjente eller ugyldige direktiver beholdes og kan rettes. Åpning og lagring uten endring bevarer kilden eksakt. Tekstfeltets normalisering av linjeskift skal aldri skrive om deler av originalen som ikke er endret.
- Ti taggknapper: title, key, time, soc, eoc, chorus, comment, x_dyn, sog og eog, pluss [] som setter inn klammer med markøren inni. Ingen egne knapper for aliaser. En knapp setter inn én tagg ved markøren uten å erstatte markert tekst eller lagre. Tomme verdifelt får markøren før sluttklammen.
- Trykk på knappene beholder fokus, markør og skjermtastatur. Tastaturbruk gir fokus tilbake til feltet. Skriving og innsatte tagger deler lokal angrehistorikk til Lagre.
- En endring i key-taggen i Råtekst er ren tekstendring og transponerer ingenting.

### Arbeidskopi og konflikt med delte kilder

- Redigering av en sang fra en delt Dropbox-kilde lager automatisk en privat arbeidskopi med diskret markering av upubliserte endringer. Publisering er en egen handling.
- Kilden endres bare når brukeren selv eksporterer eller publiserer via OS/Dropbox. Synk overskriver aldri en upublisert arbeidskopi.
- Er originalen endret etter at arbeidskopien ble laget, varsles konflikt med sammenligning av opprinnelig kilde, ny kilde og arbeidskopi. Ingenting overskrives automatisk; brukeren bestemmer og kan vente.

### Refreng og eldre markører

- Første `{soc}…{eoc}` vises helt med overskriften «Refreng» og kan ikke foldes. Senere `{chorus}`-henvisninger har samme overskrift og foldes hver for seg ved trykk. Foldevalget lagres per forekomst i det personlige laget; nye henvisninger starter sammenfoldet. Ingen egen innstilling for kort eller utvidet visning. Originalfilen endres ikke.
- Import foreslår `[Solo]` og `[Fele]` som `{comment: Solo}` og `{comment: Fele}`. Gjentatt `[Ref]` blir `{chorus}` når et refreng er definert tidligere, ellers `{comment: Refreng}`. Markører i klammer tolkes ikke som akkorder bare på grunn av klammene.

## 4. Sangvisning, personlige tilpasninger og akkorder

### Notater og gulmarkering

- Notater og gulmarkeringer vises umiddelbart i sangvisningen uten ekstra trykk, og endrer ikke originalen. De lages og endres bare i Rediger.
- Notater er korte. Feltet har én linje og ingen størrelseshåndtak; visningen kan bryte lange notater. Åpning og lukking uten endring beholder notatet som det var.
- Et notat har egen identitet og fast logisk linjeposisjon. Gjentatte refrengforekomster telles hver for seg, tomme linjer og merknader teller med, og metadata og skjermbryting påvirker ikke nummereringen. Notatet blir på sin linje når teksten endres; det følger ikke ord eller avsnitt.
- Notatverktøyet plasserer notatet uttrykkelig, også i margen eller på tomme linjer. Notatet ligger i et overlegg uten å endre sangens linjebryting. Forankringen er tynn, dempet og stiplet, normalt vannrett ved teksthøyden, og går til siste tegn eller til margen ved tom linje. Notater som står tett, fordeles uten overlapp med rette vinkler i forbindelsen.
- Langt trykk velger et notat; drag flytter det til en gyldig logisk linje med synlig forankring underveis. Forhåndsvisning og resultat er like. Refrengoverskrifter er ikke gyldige mål. Et mål som ville gi overlapp, avvises. Flytting er ett angresteg, viser ingen bred ramme rundt mållinjen og overskriver aldri et annet notat. Escape avbryter; Alt+pil opp/ned flytter med tastaturet.
- Notater skjules eller slettes aldri ved tekstendring. En posisjon utenfor teksten plasseres så langt ned som mulig, og kollisjoner legges etter hverandre nederst i fast rekkefølge. Uten sangtekst vises alle notatene under hverandre og kan fortsatt redigeres.
- Gulmarkering velges på hele ord med endehåndtak og kan dekke ett sammenhengende område over flere linjer. På PC brukes verktøylinjen uten ekstra popup. Pennen gjelder ett utvalg og slås så av. Langt trykk velger en markering, og Fjern fjerner hele. Ingen loddrett strek eller frihånd.
- Markeringer lagres med linje- og tegnkoordinater. Sikre markeringer følger teksten når den endres; usikre kan falle bort, men markerer aldri feil ord. Ingen avklaringsdialoger, varsellister eller historikk. Samme regel gjelder eksterne tekstoppdateringer.
- Ankrene lagrer bare posisjon, aldri kopi av originalteksten. Tomme notater og markeringer fjernes.
- Notatene vises helst til høyre, gjerne som halvgjennomsiktig overlegg. Se [DESIGN](DESIGN.md#sangredigering-og-personlige-tilpasninger).
- Det finnes ingen egen «sist gjennomgått fremføringsversjon».

### Toneart, capo og stemming

- `{key: …}` er faktisk toneart, uavhengig av capo. Den vises alene i en diskret pille. En egen pille viser capo og grepstoneart, for eksempel «Capo 7: Am». Begge vises samtidig, også på setlisteraden.
- Pillene står i rekkefølgen toneart, takt, capo og stemming. De kan ikke endres direkte; verdiene endres med verktøylinjen. Takt er fritekst fra første `{time: …}`, for eksempel «Valsetakt» eller «4/4 Trainbeat», og er 4/4 når taggen mangler.
- Capo og stemming er personlige per sang, huskes på tvers av setlister og endres bare i Rediger. Capo skrives aldri i sangfilen. Stemming er fritekst og endrer ikke grep.
- Capo bestemmer hvordan akkorder og akkordskjema vises og skrives inn. Det finnes ikke noe eget valg for akkordvisning. Originalakkordene lagres som faktiske akkorder: C skrevet inn med capo 2 lagres som D. B er internasjonal B; H godtas som alias. Ukjente symboler og N.C. beholdes.
- Capo velges med minus og pluss rundt et tall, uten tekstfelt. Bare 0–11 er lov; knappene deaktiveres ved grensene. Treffområdene er minst 44 px; piltaster og Home/End virker. Capo 0 heter «Uten capo» i Rediger og skjules i fremføring. Stemming uten avvik heter «Standard stemming».
- Manglende toneart eller akkorder gir ingen oppdiktet grepstoneart og hindrer ikke andre tilpasninger.
- Toneart-verktøyet transponerer inline-akkorder, alle felles skjemaer og det personlige skjemaet samlet, som ett angresteg. Capo og stemming endres ikke. Første gang en toneart settes, flyttes ingen akkorder, og appen gjetter aldri toneart. En senere ekstern endring av sangfilen transponerer ikke det personlige skjemaet og spør ikke om det.

### Eldre filer

- Nye filer tolkes som faktiske akkorder. Eldre filer skrevet med capo-grep tolkes ikke automatisk som faktiske akkorder, og originalen skrives aldri om uten godkjenning.
- Import skal forstå kombinasjoner som `key: D`, `capo: 2`, `relative key: C`: D er faktisk toneart og C grepene med capo 2.
- Akkordlinjer uten klammer, taktstreker og rene akkordskjemaer hjelpes over til ChordPro. Rene skjemaer bruker `{start_of_grid}`/`{end_of_grid}` og kan være hele sanger uten tekst.
- Arbeidsflyten er: åpne eller importere → forslag → kontroll og redigering → godkjenning → lagring. Brukeren trenger ikke rydde filene på forhånd.

### Akkordskjema

- Sangen har én skjemavisning. Finnes et personlig skjema, vises det; ellers felles grid fra originalen; ellers ingenting. De vises aldri samtidig.
- Brukeren velger felles eller personlig skjema i verktøylinjen. Det personlige skjemaet lagres i det personlige laget og kan startes fra felles skjema, eller tomt når felles skjema mangler.
- Skjemaet redigeres som fritekst med taktstreker i en bred dialog med Avbryt/OK, uten rammetagger. Form, etiketter og flere gridblokker bevares. Overskriften er «Felles akkordskjema» eller «Personlig akkordskjema», med «, capo N» når capo ikke er 0. Inndata er grepene med valgt capo; OK regner om til faktiske akkorder. En endret capo regner om både tekstakkorder og skjema med en gang. Et ugyldig utkast erstatter ikke siste gyldige skjema. Et tomt personlig skjema gir felles skjema tilbake.
- Takter vises kompakt etter innholdet. Et punktum som eget element er en tom celle, vist som én ekstra mellomromsbredde. Alle tomme celler bevares, uten grense på fire. Vanlige mellomrom betyr ingenting rytmisk. Appen legger ikke til tomme slag eller kolonner. Eksplisitt shape bevares, og antall takter per rad respekteres uten fylleceller.
- Skjemaet står kompakt under tittelen og fester seg øverst ved scrolling i fremføring. Under redigering scroller det med sangen.
- Pin-knappen veksler sticky av og på for denne åpningen. pin-on viser festet, pin-off viser løsnet og kan trykkes igjen. Fokus blir på knappen. Tilstanden overlever appoppdatering, men lagres ikke. Neste åpning starter med sticky på; under redigering er pinnen skjult.
- Et for høyt sticky-skjema på liten skjerm komprimeres automatisk i stedet for å få egen scroll. Se [DESIGN](DESIGN.md#implementert-sangflyt).

## 5. Dynamikk

- Dynamikk er felles arrangementsinformasjon og en visuell påminnelse for musikere som kjenner sangen, ikke en tidslinje eller pp–ff-notasjon.
- Fem nivåer, 1–5, med 3 som normal. `{x_dyn: N}` står i originalfilen, og et nytt nivå gjelder straks og til neste tagg. Har sangen gyldige tagger, gjelder nivå 3 før den første. Uten gyldige tagger vises ingen profil eller marg.
- Profilen er én sammenhengende søyle i en fast 30 px venstremarg ved sangteksten, under tittel og akkordskjema. Venstrekanten er rett; høyrekanten er 5/10/15/20/25 px inn for nivå 1–5, med myke overganger. Bredden er uavhengig av tekststørrelsen. Fargen er Organisk-rollen Dynamikk. Profilen speiles ikke. Margen fjernes når dynamikk er slått av, når gyldige tagger mangler og på skjermer smalere enn 320 px. Profilen viser ikke crescendoer, og linjer er ikke varighet.
- I Rediger vises en markør for hver tagg i samme marg, også inne i refreng.
- En refrenghenvisning gjentar ikke refrengets dynamikktagger; nivået før henvisningen gjelder hele gjentakelsen. Ønsker brukeren egne nivåskifter i et senere refreng, legger hen inn en egen refrengblokk. I Rediger er henvisningene alltid sammenfoldet; Visning får tilbake tidligere åpne henvisninger.
- Ingen personlig dynamikk, ingen egen annoteringsfil og ingen `{dyn:…}`. Ramper og frihånd er utenfor v1.

## 6. Setlister

### Oversikt og navn

- Setlister opprettes lokalt via navnedialog med Avbryt/Lagre. Oversikten viser navn og antall sanger, nyeste først. Etter Lagre åpnes den nye setlisten; Tilbake viser den i oversikten.
- Endre info beholder ID og rekkefølge. Like navn er lov. Slett krever bekreftelse og berører bare setlisten.
- Posisjon og valgt setliste beholdes ved besøk i Innstillinger og appoppdatering, og et ulagret navn beskyttes. Vanlig oppstart åpner ikke siste setliste igjen.

### Innhold og fremføring

- En setliste tilhører ikke nødvendigvis en kilde. Sanger velges på tvers av kilder, med ett eller flere kildefiltre. En sangrad i setlisten viser tittel, faktisk toneart, capo med grepstoneart og relevante kommentarer. Stemming vises bare når den avviker.
- En egen redigeringsmodus viser legg til, fjern og flytt, med langt trykk og drag for rekkefølge. Vanlig visning skjuler disse. Ingen egen konsertmodus.
- Nye sanger legges nederst i den rekkefølgen de ble valgt, også ved flervalg. En ny tom setliste åpnes i redigering, en eksisterende i visning.
- Alt autospares. Ingen Lagre- eller Angre-knapp i setlisteeditoren; navnedialogen beholder sin Lagre.
- Samme sang kan bare stå én gang i en setliste. Pauser og fritekstpåminnelser har egne rader som flyttes som sanger. En pause kan ha varighet, men må ikke.
- Trykk åpner fremføring. Sideveis sveip går til neste eller forrige element, også pauser og påminnelser. Sangen starter alltid øverst ved valg eller sveip. Appoppdatering beholder derimot posisjonen.
- Tilbake går til setlisten med sist viste element markert og plassert så nær midten som listen tillater, uten synlig scrollanimasjon eller kunstig luft.
- Oversikten har nyeste først og kan sorteres manuelt.
- Duplisering gir en ny setliste med samme sangreferanser.

### Lagring, deling og publisering

- Setlister virker fullt offline og synkroniseres til privat app-mappe når brukeren starter synk.
- Deling til felles Dropbox-mappe skjer som fileksport eller OS-deling, ikke via API, også til en PC/Mac-mappe som Dropbox selv synkroniserer.
- En publisert setliste kan redigeres videre privat. Den publiserte `.setlist`-filen endres først ved ny publisering, og synk overskriver ikke upubliserte endringer. Er begge endret, gir det samme konfliktflyt som for sanger.
- **Transport:** `.setlist` er selvforsynt JSON med setlisten, referansene og full tekst for alle sangene, og kan deles via e-post, Messenger, Dropbox osv. Filen er et øyeblikksbilde.
- **Senere synk:** bibliotekets nyeste versjon av sangen gjelder. Mangler kilden, beholdes den innebygde teksten i setlisten merket «Kilde mangler», uten at det opprettes en sang i biblioteket. Brukeren kan velge å importere den. Private data slettes aldri automatisk.
- **Første import:** eksisterende sanger gjenbrukes når det er mulig. En tilgjengelig, men usynkronisert kilde gir tilbud om å koble og synke den. En utilgjengelig kilde gir lokal import av sanginnholdet uten kildesynk; sangen kan eksporteres som fil. Appen gjetter ikke hvorfor en sang mangler. Dette er en annen situasjon enn senere synk.

## 7. Identitet

- Hver sang har en stabil intern ID uavhengig av leverandør. Dropbox-fil-ID, kilde og sti er bare oppslagsinformasjon. Lokale sanger får ID uten Dropbox.
- Bytte av leverandør eller gjenoppretting med ny Dropbox-ID skal ikke kreve ny domenemodell eller ødelegge identiteten.

## 8. Dropbox, synk og backup

### Tilgang

- OAuth 2.0 med PKCE, uten app secret. Dropbox-appen bruker App folder, ikke full Dropbox. Scopes står i [ARCHITECTURE](ARCHITECTURE.md#tilgang).
- Domenet og lokal lagring avhenger ikke av Dropbox. Dropbox ligger bak ett avgrenset grensesnitt med én adapter, uten pluginrammeverk.
- Hele appen virker uten Dropbox-konto. Vanlig oppstart åpner direkte uten ny innlogging. Et utløpt token fornyes automatisk når det går. Er tilgangen bekreftet tapt, vises Koble til Dropbox igjen og biblioteket beholdes; det gjelder også når tapet oppdages i Publisering eller Kopier delingslenke. Offline krever ingen gyldig Dropbox-økt.
- Dropbox kan kobles til senere uten datatap. Første tilkobling sammenligner lokale data og skydata: nye og identiske data slås trygt sammen, og avvik krever brukerens valg. En ny enhet henter private data ved første tilkobling.
- Koble fra beholder sanger og private data lokalt, merker kildene frakoblet, tilbakekaller tokens og fjerner dem fra enheten. Ny tilkobling krever ny godkjenning. Koble fra krever E03 med Avbryt som trygt fokus.
- Delte lenker er lesende kilder, og undermapper leses også. Fra andres mapper hentes bare `.cho` på inntil 10 MB; andre filer ignoreres, og kilden endres aldri. Den private app-mappen brukes til innstillinger, kilderegistrering, egne sanger, personlige lag og setlister. Skriveretten brukes aldri til å publisere i andres mapper.

### Første samordning

- Første uttrykkelige tilkobling samordner begge biblioteker. En husket tilkobling er ikke en ny første gang.
- Bøker med samme navn (normalisert, uavhengig av store og små bokstaver) kobles til én skybok. Sanger i samme bok med samme ikke-tomme opprinnelige filnavn kobles når paret er entydig. Identisk tekst og personlig lag gir én identitet uten spørsmål; forskjeller gir E04/E03. Lokale ID-er, ankre og referanser beholdes.
- Ingen sammenslåing på tittel, ved flere kandidater eller for senere importer. To sanger med ulike filnavn forblir to sanger, også om brukeren velger Dropbox i alle konflikter. En avbrutt reservasjon uten publisert fil hindrer ikke gjenkjenningen. Etter første samordning brukes lagrede identiteter, ikke navn. Oppdager to enheter samme Dropbox-fil samtidig, kobles en upublisert reservasjon til den publiserte filen, med lokale ID-er og referanser beholdt. Et filnavn eller like bytes gir aldri alene eierskap til en fil.
- En tom installasjon kan hente hele biblioteket. Utenom første samordning er ulike ID-er alltid ulike sanger, også med lik tekst og tittel.

### Hva som synkroniseres når

- **Synkroniser** henter endringer fra andre enheter og åpner utsatte konflikter, én om gangen. Synk startes aldri av timer eller polling. Knappen er deaktivert uten nett.
- **Automatisk opplasting:** ferdige endringer i egne sanger og personlige lag lastes opp når sangen forlates, og ferdig bokadministrasjon når ingen sang er åpen. Opplastingen henter aldri fjernendringer inn lokalt. Utsatt opplasting prøves igjen ved neste mulighet.
- Synk pauses mens en sang er åpen, i både Visning og Rediger, også ved besøk i Innstillinger. Utgang venter på autosparing.
- Etter krasj beholdes merkingen av endringer som ikke er lastet opp, og alle gyldig lagrede endringer, men automatisk opplasting venter til brukeren trykker Synkroniser. Sangen trenger ikke åpnes igjen.
- Et gammelt svar brukes aldri over en ny sangøkt eller en nyere lokal endring.
- Synk overfører bare faktiske endringer. En manuell synk uten endringer trenger normalt bare én forespørsel til Dropbox, og automatisk opplasting uten lokalt arbeid gjør ingen kall.
- Eksterne kilder og setlister er ikke med i den private synken ennå.

### Plassering i Dropbox

- Egne sanger ligger som `.cho` i `Songbooks/<sangbok>/Private` eller, når de er publisert, `Shared`. Strukturen står i [ARCHITECTURE](ARCHITECTURE.md#mappestruktur-i-app-mappen).
- Nye filer i Private og nye mapper under Songbooks, også tomme, oppdages ved Synkroniser. En omdøpt kjent mappe er navneendring på samme bok, og Dropbox-navnet brukes i appen. Slettede bøker kommer aldri tilbake via navnet.
- Nye filnavn følger §3. Kollisjoner får leselig nummerering. Eksisterende filnavn overskrives eller omdøpes ikke for å rydde.
- En importert tekstfil med annen endelse enn `.cho` får en uendret kopi i Originals og en identisk `.cho` i Private. Kopien gjenkjennes på andre enheter. Sanger opprettet i appen får ingen Originals-kopi.
- Filer over 10 MB (10 000 000 byte) hoppes over og får ingen tittelbasert erstatning. Kjent lokalt innhold beholdes, og filen regnes ikke som overført.

### Konflikter

- Original og personlig lag vurderes hver for seg mot felles basis. Bare lokal endring lastes opp; bare fjernendring hentes ved Synkroniser. Endring på begge sider med ulikt innhold krever valg, også uten kjent basis.
- **E04** for sangtekst: Lokal versjon / Dropbox / Opprett ny fil. Ny fil beholder Dropbox-originalen og lager en privat kopi med ny ID.
- **E03** for personlig lag: hele Lokal versjon eller hele Dropbox.
- Ingen standardvalg. Escape eller trykk utenfor utsetter konflikten. En konflikt rett etter at brukeren forlot sangen, kan åpnes straks; en konflikt fra forsinket opplasting registreres bare. Ingen konfliktliste.
- Motstridende boknavn, flytting og sletting holdes tilbake med forklaring. Feil i én sang hindrer ikke trygt arbeid med andre.
- En konfliktdialog som åpnes automatisk, gir bare lov til det aktuelle valget og henter ikke inn andre bøker fra Dropbox.

### Status og feil

- Synkronisering-siden har Koble til Dropbox midtstilt før tilkobling, og to paneler uten overskrifter etterpå.
- Status under Synkroniser er én av: Ikke synkronisert, Synkroniserer…, Sist synkronisert med dato og tid, eller «Synkronisering feilet (Feilkode [kode])». Tidspunktet endres bare av fullført manuell synk; første samordning regnes som manuell. Automatisk opplasting endrer det ikke.
- Ingen kø-, pause- eller hjelpetekster og ingen statusikoner på sangradene. Bare feil som krever en konkret handling fra brukeren, får forklaring.
- Normale pauser, venting på Dropbox, gamle kjøringer, avbrutt samtykke og ekstern mappeomdøping er ikke feil. En ugyldig OAuth-retur logges uten å endre synkstatus.
- Ved ratebegrensning venter appen slik Dropbox ber om, bare innenfor en pågående kjøring. Ventetiden huskes per konto og kanal gjennom omstart. Åpning av en sang, nyere lokale endringer, offline og frakobling avbryter ventingen. Vedvarende begrensning beholder arbeidet lokalt og gir SYNC-007.
- Feilteksten er ikke klikkbar. Et kopiikon rett etter den kopierer feilen og tilhørende logg, uten popup. Ikonet vises bare ved feil.
- Diagnostikken lagres lokalt (inntil 20 oppføringer per kanal), overlever omstart og virker uten nett. Den lastes opp til Dropbox når det går, og kan verken endre synkresultatet eller blokkere lokal bruk. En ny teknisk OAuth-oppføring fortrenger aldri en aktiv synkfeil, og et ukjent loggformat overskrives ikke. Den inneholder aldri kontoopplysninger, tokens, fil- eller boknavn, brukerinnhold eller rå svar. Detaljer i [ARCHITECTURE](ARCHITECTURE.md#diagnostikk).
- Synkroniser og Utfør viser `synkroniser.svg` foran teksten, også i hvile, og ikonet roterer mens handlingen pågår. Under synk viser N01 et diskret ikon der miljømerket står, på alle sider. Med redusert bevegelse er ikonet statisk.

### Publisering av egne sanger

- **F01–F08.** Publisering vises i N02 med `publiser.svg` når Dropbox er konfigurert, også offline. Frakobling skjuler menyvalget. Oppsummeringen viser totalt, publisert og upublisert for alle egne sanger, uavhengig av filter og fane. D09 i N01 deler bokvalget med Sanger. En bok som bare er kjent i Publisering, vises tom i Sanger til neste synk. H03 viser Upublisert først (`status-privat.svg`) og Publisert (`status-delt.svg`). Begge fanene sorteres alfabetisk og har tomtilstand.
- **F09–F18.** L01 viser tittel og toneart/takt. Trykk på raden veksler valg med L05s hake. Velg alle står til høyre på H03-raden og gjelder hele fanen innenfor filteret; er alt valgt, opphever neste trykk valget, og ved delvis valg velges resten. Valg utenfor visningen beholdes. Ingenting flyttes før Utfør. Handlingsfeltet nederst viser begge antall og én Utfør-knapp, med plass til siste rad og safe-area. Under Utfør står «X filer publiseres · Y filer avpubliseres», og valgene er deaktivert. Etterpå står «X filer ble publisert · Y filer ble avpublisert» for bekreftede flyttinger. Bare retninger med filer vises, med entall for én fil. Neste valg eller utgang tilbakestiller teksten.
- **F19–F24.** Utfør gjør begge retninger samlet. Samme `.cho`-fil flyttes mellom Private og Shared i sin egen sangbok, også Standard. Identitet, original, personlig lag, sangbok og setlister beholdes. Publiserte sanger kan redigeres og lastes opp til Shared som vanlig.
- **F25–F36.** Åpning og Utfør bygger på fersk og komplett Dropbox-metadata. Åpning oppdaterer bare Publiserings egen oversikt; «Sist synkronisert» og sangbasen endres ikke. Før flytting kontrolleres fil-ID, revisjon og mål, og etter ny venting kontrolleres alt igjen. En sang som allerede ligger riktig, er ferdig. En sang som aldri er lastet opp, lastes først opp til Private. Tvetydig identitet, innholdskonflikt eller uavklart overføring beholder valget. Bekreftede sanger flyttes til riktig fane og fjernes fra valget. Etter feil vises gjenstående valg og delresultat. Uten Dropbox-forbindelse vises siste oversikt med valg, Velg alle og Utfør deaktivert. Hver flytting krever et nytt uttrykkelig trykk på Utfør.
- **F37–F40.** Kopier delingslenke i Sangbøker bruker L02/H04 og `status-delt.svg`. Dropbox gjenbruker eller lager en leselenke til bokens Shared-mappe. Handlingen krever nett og delingstilgang, som hentes med uttrykkelig samtykke første gang. Kopieringen bekreftes når utklippstavlen er oppdatert. Feiler kopieringen, vises lenken for manuell kopiering. Avslått delingstilgang beholder vanlig tilkobling.
- **F41–F45.** Komponentene og ikonene følger DESIGN. Øvrige deler av appen følger sine egne regler.

### Backup

- Eksport gir én ZIP med to deler: alle tilgjengelige sanger, både private og fra delte kilder, som lesbare filer i åpne tekst- og ChordPro-formater med kilder og undermapper bevart, og komplett versjonert JSON med sanger, kilde- og filmetadata, personlige lag og relevante innstillinger, med ID-er og kildehenvisninger. Filene er for manuell tilbakeføring, JSON for rekonstruksjon.
- ZIP er bare backup, aldri synkformat. IndexedDB og cache er ikke backup.
- Setlister tas ikke med i backup.
- Ingen omfattende gjenoppretting i appen, sammenslåing eller automatisk ID-kobling i v1. Ved datatap gjennomgås backupen utenfor appen, sangfilene legges tilbake i Dropbox og leses inn med vanlig synk.
- Uten Dropbox minner appen om backup.

## 9. Ikke bygget ennå

Disse vedtatte delene av v1 mangler. Reglene over gjelder når de bygges.

- Administrasjon av eksterne kilder, lesende synk fra delte mapper og arbeidskopier (§3, §8).
- Konvertering av eldre filer og capo-notasjon (§4). Parseregler og tvetydige tilfeller avklares ved implementering.
- Utvidet import av mange tekst-, Word- og PDF-filer til `.cho` ([#33](https://github.com/geirskoglund/hobos-songbook/issues/33)): automatisk, uten godkjenning per fil. Uttrekkbar tekst tas med, bilder ignoreres og kolonner leses kolonnevis. Gjenkjent tittel brukes; uten lesbar tekst blir filnavnet uten endelse tittel. Filer over 10 MB hoppes over uten erstatningsfil. Originalen bevares i Originals. Ingen obligatorisk gjennomgang i Råtekst, og sangordene skrives ikke om automatisk; sangene kan redigeres etterpå. Ingen OCR i v1.
- Setlistenes innhold, fremføring, synk og `.setlist`-transport (§6).
- Eksport og backup (§8).
- Skjermvåkenhet: sangvisning og setliste holder skjermen våken som standard der nettleseren støtter det, og brukeren kan slå det av. Appen lover ikke at dvale alltid kan hindres.
- Matching mot eksterne kilder og fil-ID-er mellom Dropbox-kontoer (§7).

Fysisk test på iPad/Safari og Android/Chrome, installert PWA og ekte Dropbox gjenstår. Se [TESTING](TESTING.md).
