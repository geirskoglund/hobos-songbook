# Hobo's Songbook

Felles språk for sangboken: hva begrepene betyr, slik de brukes i issues, kode, tester og samtaler. Regler og oppførsel står i `docs/REQUIREMENTS.md` og `docs/DECISIONS.md`.

Godkjente synonymer har egen oppføring som viser til hovedbegrepet («Se X»). Ord under _Unngå_ skal ikke brukes om begrepet.

## Bibliotek

**Sang**:
En selvstendig sang i brukerens bibliotek, med egen identitet uavhengig av tittel og fil.
_Unngå_: låt, fil

**Sangbok**:
En navngitt gruppering av sanger; hver sang tilhører nøyaktig én sangbok.
_Unngå_: kontekst, kilde, mappe

**Setliste**:
En ordnet rekke referanser til sanger, for eksempel til en konsert eller øving.
_Unngå_: spilleliste

## Sanginnhold

**Original**:
Sangens felles tekst med akkorder, slik den deles med andre.
_Unngå_: kildefil, master

**Personlig lag**:
Brukerens personlige tilpasninger til en sang, samlet og holdt adskilt fra originalen. Brukes når tilpasningene omtales som en helhet, for eksempel ved synk og konflikt.
_Unngå_: overstyring, egendata, persondata (betyr personopplysninger), personlag

**Personlige tilpasninger**:
Det brukeren har lagt til eller endret for seg selv i en sang: notater, gulmarkeringer, capo, stemming og personlig akkordskjema.
_Unngå_: persondata

**Notat**:
En personlig merknad knyttet til et bestemt sted i sangen.

**Gulmarkering**:
En personlig utheving av et tekstparti i sangen.

**Anker**:
Festepunktet som knytter et notat eller en gulmarkering til et bestemt sted i originalen.
_Unngå_: personanker

**Faktisk toneart**:
Tonearten sangen faktisk lyder i.
_Unngå_: klingende toneart

**Faktiske akkorder**:
Akkordene slik de faktisk lyder, uavhengig av capo.
_Unngå_: klingende akkorder

**Grepstoneart**:
Tonearten slik akkordene gripes med capo.
_Unngå_: relativ toneart (forveksles med paralleltoneart)

**Capotoneart**:
Se Grepstoneart.

**Capo**:
Brukerens personlige capoposisjon for en sang.

**Stemming**:
Gitarens stemming for en sang når den avviker fra standard.

**Akkordskjema**:
Oversikten over grepene for sangens akkorder; felles i originalen eller personlig.

**Dynamikk**:
Felles angivelse av hvor sterkt et parti skal spilles.

**Refreng**:
En navngitt blokk i sangen som kan gjentas.

**Refrenghenvisning**:
En gjentakelse av et refreng som viser til blokken i stedet for å skrive den ut på nytt.
_Unngå_: kopi av refreng

## Bruk av en sang

**Fremføring**:
Å bruke sangen til å spille etter, uten å endre den.
_Unngå_: konsertmodus, lesemodus

**Redigering**:
Å endre originalen eller det personlige laget.

**Sangøkt**:
Tiden fra en sang åpnes til den forlates.

## Deling og synk

**Privat Dropbox**:
Brukerens egen lagringsplass i Dropbox for sangbøker, sanger og personlige lag.
_Unngå_: sky, server, backend

**Privat sang**:
En egen sang som bare brukeren selv har tilgang til.
_Unngå_: upublisert fil

**Publisert sang**:
En egen sang som andre kan lese via sangbokens delingslenke.
_Unngå_: delt fil, opplastet sang

**Publisering**:
Å gjøre en privat sang til en publisert sang.
_Unngå_: opplasting, synk, deling

**Avpublisering**:
Å gjøre en publisert sang privat igjen.
_Unngå_: sletting, oppheving av deling

**Synkronisering**:
Å samordne det lokale biblioteket med privat Dropbox.
_Unngå_: oppdatering, refresh

**Sidefil**:
Filen i privat Dropbox som holder det personlige laget for én sang, ved siden av sangfilen.
_Unngå_: personsidefil

**Konflikt**:
Når samme sang eller samme personlige lag er endret på to steder og brukeren må velge hvilken versjon som skal gjelde.

## Miljø

**Miljø**:
Én av de to selvstendige utgavene av appen, produksjon eller test, hver med egne data.
_Unngå_: versjon, bygg
