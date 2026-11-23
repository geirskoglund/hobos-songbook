# Beslutninger

Gjeldende beslutninger med begrunnelse. Detaljreglene står i [REQUIREMENTS](REQUIREMENTS.md); her står hva som er valgt og hvorfor. Nye beslutninger får neste ledige nummer.

## Produkt og data

- **D01 – Lokal bruk først.** Statisk PWA uten backend eller skydatabase, fullt brukbar uten konto. Sangboken skal kunne åpnes på øving uansett om Dropbox-økten virker. Dropbox kobles til med PKCE og er et tillegg (§8).
- **D02 – Stabil intern identitet.** Sang-ID er adskilt fra filnavn, fil-ID, kilde og sti, og lik tittel gir aldri felles identitet. Da kan filer flyttes, omdøpes og byttes leverandør uten at notater og setlister mister sangen. Appen skriver ingen ID inn i ChordPro-filer (§7).
- **D03 – Felles original og personlig lag.** Notater, gulmarkering, capo, stemming og personlig akkordskjema lagres adskilt fra originalen, som deles med andre. Originalen lagrer faktiske akkorder; capo påvirker bare visning og innskriving. Ankrene lagrer posisjon uten kopi av teksten, så en endret original gir pragmatisk tilpasning i stedet for avklaringsdialoger: notater blir på linjen, sikre markeringer følger teksten og usikre faller bort (§4).
- **D04 – Autosparing og uttrykkelig publisering.** Sangendringer autospares lokalt; bare Råtekst og større skjemaer har egen bekreftelse. Endringer i egne sanger lastes opp automatisk der sangen allerede ligger, men å flytte en sang mellom privat og delt krever Utfør i Publisering. Eneste unntak er bekreftet sletting av en sangbok, der sangene blir private. Ingen versjonshistorikk for sanger (§3, §8).
- **D05 – Brukeren styrer nedlasting.** Fjernendringer hentes bare når brukeren trykker Synkroniser, aldri med timer eller polling, slik at sangen ikke endrer seg under øving eller konsert. Egne ferdige endringer lastes opp automatisk. Synk står på pause mens en sang er åpen. Versjonsvern og samordning per ID beskytter nyere skydata, og konflikter avgjøres av brukeren (§8).
- **D06 – Bevar data ved usikkerhet; Dropbox er master ved bekreftet sletting.** Feil, fravær og ufullstendige svar er aldri bevis for sletting. Når brukeren derimot har slettet en fil eller mappe i sin private app-mappe, er Dropbox fasit, også over lokale endringer som ikke er lastet opp. Sangfiler i Dropbox slettes i Dropbox, ikke i appen, og appen har ingen papirkurv (§2).
- **D07 – Setlister er referanser; transport er øyeblikksbilde.** Setlister internt dupliserer ikke sanginnhold. En delt `.setlist` har full tekst for deling og som reserve, men bibliotekets versjon vinner ved synk (§6).
- **D08 – Åpen backup med tilsiktet redundans.** Backupen har både lesbare sangfiler og komplett JSON, slik at data kan reddes uten appen. Appen har ingen omfattende gjenoppretting eller sammenslåing i v1 (§8).
- **D09 – Dynamikk i originalfilen.** Dynamikk er felles arrangementsinformasjon og lagres som `{x_dyn: N}` i originalen, ikke som personlig data. Fem nivåer vist som en profil i venstremargen er nok som påminnelse for musikere som kjenner sangen (§5).
- **D10 – Avgrenset v1.** Ingen OCR, frihånd, autoscroll, konsertmodus, fritekstsøk, flere skyleverandører eller pluginrammeverk. Utvidet import av Word og PDF ([#33](https://github.com/geirskoglund/hobos-songbook/issues/33)) er med, men uten OCR.

## Appskall og levering

- **D11 – Lite TypeScript/Vite-skall.** Ren HTML, CSS og TypeScript uten UI-rammeverk, låste versjoner av Vite, TypeScript og PWA-verktøy, og Node 24 LTS. Det holder oppstarten liten uten å bygge rammeverk på forhånd.
- **D12 – Generert worker og eksplisitt oppdatering.** Workbox genererer precache. Brukeren velger selv når en ny versjon tas i bruk, og oppdatering sletter aldri lagring. Bred cacherydding på origin er av for å ikke røre den andre kanalen.
- **D13 – To PWA-er på én origin.** `/app/` og `/test/` har hver sin identitet og sine lagringsnavn, og lagringen følger kanalen, aldri commit eller PR. Da kan nye testversjoner prøves uten å miste testdata, og kanalene blandes ikke sammen ved et uhell. Skillet er ikke en sikkerhetsgrense mot skript på samme origin.
- **D14 – Betrodd master styrer publisering.** Bare validert master-infrastruktur publiserer, og PR-kode kjører aldri med deployrettigheter. Produksjon krever full validering med e2e; test krever bare den raske sjekken. Detaljer i [TESTING](TESTING.md).
- **D15 – Godkjenning før merge.** Produktansvarlig tester på `/test/` og godkjenner uttrykkelig. Grønn CI er bare teknisk validering.
- **D16 – Ett autoritativt dokumentsett.** CLAUDE.md er inngangen. REQUIREMENTS, DECISIONS, ARCHITECTURE, DESIGN og TESTING har hvert sitt ansvar, og hver regel står ett sted. Dokumentene beskriver gjeldende tilstand; historikk ligger i git og issues. Når en regel endres, erstattes den gamle teksten.

## Redigering og UI

- **D17 – Én sangflate med autosparing og felles historikk.** Visning og redigering er samme flate, slik at brukeren ikke mister lesestedet. Original og personlig lag deler én angrehistorikk som varer til sangen forlates. Verktøy velges før bruk, og elementer slettes ved å velge dem og trykke Fjern, uten slettekryss eller slettemodus (§3).
- **D18 – Én akkordrepresentasjon.** Akkorder lagres som faktiske akkorder overalt og vises med grep etter valgt capo. Toneart-verktøyet transponerer alt samlet; ingenting transponeres skjult eller automatisk (§4).
- **D19 – ChordPros tomme celler.** Et punktum i grid er en tom celle, ikke nødvendigvis pause, og vanlige mellomrom har ingen rytmisk betydning. Vi følger formatet slik det er, uten egne tillegg (§4).
- **D20 – Appen eier tekst- og kontekstbetjening.** Nettleserens kontekstmenyer, verktøytips og valideringsballonger er erstattet på alle skjermer, slik at nettleserens menyer ikke tar over (§1).
- **D21 – Ett validert bygg, gjenbrukt ved publisering.** Det som publiseres, er nøyaktig det bygget som ble validert. Publiseringen installerer ikke på nytt og kjører ikke testene igjen. Detaljer i [TESTING](TESTING.md).
- **D22 – Ett felles UI-grunnlag.** Designsystemet i [DESIGN](DESIGN.md) og `docs/design/` er bindende, og hver kontrolltype finnes én gang. Skisser i issues er illustrasjoner; vedtatt design gjelder ved avvik. Nye kontrolltyper krever produktavklaring. Organisk er fast mørk palett. Ingen gule eller gylne fokus-, aktiv- eller hoverrammer; tastaturnavigasjon bruker én felles dempet markering. Ved gjenbruk gjøres en nummerert visuell egensjekk, også av arvede avvik.
- **D23 – Sangbok som gruppering.** Hver sang tilhører nøyaktig én sangbok, uavhengig av fil og kilde. Opprett og Importer krever et uttrykkelig valgt mål, slik at sanger ikke havner i en tilfeldig bok. Privat Dropbox følger bokens ID gjennom omdøping og sletting, og en omdøpt mappe i Dropbox er samme bok (§2).
- **D24 – Sticky akkordskjema kan løsnes.** Pin-knappen veksler sticky av og på for åpningen, men valget lagres ikke. Neste sangåpning starter med sticky på (§4).
