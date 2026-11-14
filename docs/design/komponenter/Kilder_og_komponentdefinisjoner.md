# Komponentkart – katalog og kilder

**Prinsipp:** Generelle UI-konsepter. Navn og varianter er normative for designreferansen; eksempler er bare illustrative. Enkelt-SVG er fasit for geometrien. Kildeansvar, normalmål, minimumsmål og responsiv oppførsel for implementerte varianter står samlet i [DESIGN](../../DESIGN.md#målregler-for-komponenter-i-bruk). Komponentvariantens geometri gjelder foran generelle standardverdier. Gule/gylne aktiv-, fokus- og hoverrammer på kontroller er ikke tillatt; den uttrykkelige fokusavklaringen i DESIGN gjelder foran eldre aksenteksempler. Valgt flate/sjekkmerke og andre faktiske verdier er egne tilstander. Issueskisser er illustrasjoner og overstyrer ikke eksisterende avklart design.

**Designgrunnlag:** `01_Designgrunnlag_oppdatert.svg` i `Design/Opprydding`. Kun de tolv navngitte fargene er brukt i komponentfilene. Ingen eldre originaler utenfor Opprydding er endret.

**Kildestatus:** Komponentene merket «flyttet» er tidligere produserte filer i Opprydding, bevart med samme filidentitet. Komponentene merket «nytt uttrekk» er rekonstruert fra oppgitte godkjente SVG-er og må ikke tolkes som nye produktbeslutninger.


## Navigasjon

### Toppfelt (N01_Toppfelt)
- **Fil:** `Komponenter/N01_Toppfelt.svg` (+ PNG)
- **Definisjon:** Tilbake til venstre; midtstilt modushandling; miljømerking og meny til høyre. Uten appnavn.
- **Variant:** Visning → Rediger / Redigering → Visning
- **Eksempel:** Rediger / Visning (ikke del av definisjonen)
- **Farger:** Toppfelt (`#211F1D`), Appbakgrunn (`#272421`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Primærtekst (`#F4EDE3`).
- **Kilder:** [05_visningsmodus_rediger.svg](https://drive.google.com/file/d/1YxOTg1VeFfc1SviWvXTKFX5OBM3v-vwd/view), [01_filinnhold_normal.svg](https://drive.google.com/file/d/1RsXYgC3lT3Tu14Hcuyy5w4PZL8BNhtup/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Navigasjonspanel (N02_Navigasjonspanel)
- **Fil:** `Komponenter/N02_Navigasjonspanel.svg` (+ PNG)
- **Definisjon:** Høyre sidepanel med rette hjørner, seksjonsdelere og bunnforankret siste valg.
- **Variant:** Aktivt/ordinært menyvalg
- **Eksempel:** Sanger / Innstillinger (ikke del av definisjonen)
- **Farger:** Toppfelt (`#211F1D`), Appbakgrunn (`#272421`), Hevet flate (`#403831`), Kontur (`#8F7B69`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Meny.svg](https://drive.google.com/file/d/1BbRiSuGFzcqc6vxbRjkAG05rD4PdCGCO/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.


## Handlinger og menyer

### Flytende handling (H01_Flytende_handling)
- **Fil:** `Komponenter/01_Flytende_plussknapp.svg` (+ PNG)
- **Definisjon:** Flytende transparent pluss; plassering må ikke dekke viktig innhold.
- **Variant:** Normal; åpen handlingsmeny vises separat
- **Eksempel:** Plussknapp (ikke del av definisjonen)
- **Farger:** Toppfelt (`#211F1D`), Sekundærtekst (`#C7BAA9`), Handling / fokus (`#E2C097`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Sangliste_plussmeny.svg](https://drive.google.com/file/d/1P5zqvIyXiSSmHT6lkgagQZWUV33c51O8/view).
- **Status:** flyttet uendret fra Opprydding.

### Verktøyknapp (H02_Verktoyknapp)
- **Fil:** `Komponenter/04_Verktoyknapp.svg` (+ PNG)
- **Definisjon:** Ikon over tekst; tydelig valgt tilstand; samme ikon for samme handling.
- **Variant:** Normal / aktiv
- **Eksempel:** Fjern (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Hevet flate (`#403831`), Sekundærtekst (`#C7BAA9`), Akkorder (`#E5BD8D`), Primærtekst (`#F4EDE3`).
- **Kilder:** [01_filinnhold_normal.svg](https://drive.google.com/file/d/1RsXYgC3lT3Tu14Hcuyy5w4PZL8BNhtup/view), [03_viskelaer_aktiv_alle_elementer.svg](https://drive.google.com/file/d/10haukqU8qCnjofTn1gI9eN4DrTundyIR/view).
- **Status:** flyttet uendret fra Opprydding.

### Fanevelger (H03_Fanevelger)
- **Fil:** `Komponenter/05_Fanevelger.svg` (+ PNG)
- **Definisjon:** Bytter innholdet i samme verktøyområde; valgt fane har understrek.
- **Variant:** Filinnhold / Egentilpasning
- **Eksempel:** Editorfaner (ikke del av definisjonen)
- **Farger:** Toppfelt (`#211F1D`), Appbakgrunn (`#272421`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Akkorder (`#E5BD8D`), Primærtekst (`#F4EDE3`).
- **Kilder:** [01_filinnhold_normal.svg](https://drive.google.com/file/d/1RsXYgC3lT3Tu14Hcuyy5w4PZL8BNhtup/view).
- **Status:** flyttet uendret fra Opprydding.

### Kontekstmeny (H04_Kontekstmeny)
- **Fil:** `Komponenter/06_Kontekstmeny.svg` (+ PNG)
- **Definisjon:** Kompakt meny med ikon og kort handlingsnavn; innhold kontekstavhengig.
- **Variant:** Åpen/lukket
- **Eksempel:** Opprett / Importer (ikke del av definisjonen)
- **Farger:** Toppfelt (`#211F1D`), Appbakgrunn (`#272421`), Hevet flate (`#403831`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Sangliste_plussmeny.svg](https://drive.google.com/file/d/1P5zqvIyXiSSmHT6lkgagQZWUV33c51O8/view).
- **Status:** flyttet uendret fra Opprydding.


## Listerader

### Listerad – tittel og metadata (L01_Listerad_tittel_metadata)
- **Fil:** `Komponenter/L01_Listerad_tittel_metadata.svg` (+ PNG)
- **Definisjon:** Stor primærtittel; liten sekundærlinje; valgfri ekstra informasjonslinje.
- **Variant:** Med/uten ekstra informasjonslinje
- **Eksempel:** Sang (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Sangliste.svg](https://drive.google.com/file/d/1VK0Gc9zOQKqDxLIfSyPLh9KIiS-iR5RR/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Listerad – tittel og antall (L02_Listerad_tittel_antall)
- **Fil:** `Komponenter/L02_Listerad_tittel_antall.svg` (+ PNG)
- **Definisjon:** Tittel og sekundært antall, uten unødvendige metadata eller leading-ikon.
- **Variant:** Med valgfri radmeny som separat betjening
- **Eksempel:** Setlisteoversikt (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Setlister.svg](https://drive.google.com/file/d/1reBJWUjyxVwvKR4z2VwlSxS-TjqAt73s/view), [Setlister_radmeny.svg](https://drive.google.com/file/d/112cydq4Jjoljf-fWyZvdAmpbmASsL-C0/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Listerad – nummerert (L03_Listerad_nummerert)
- **Fil:** `Komponenter/L03_Listerad_nummerert.svg` (+ PNG)
- **Definisjon:** Sekvensnummer i egen smal kolonne; primærtekst og metadata til høyre. Ingen flyttehåndtak.
- **Variant:** Enlinjet/tolinjet innhold
- **Eksempel:** Nummerert sang (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Setliste.svg](https://drive.google.com/file/d/1XWuZOuyV3dIn8HmDnMDf0a94zbd5-gSV/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Listerad – spesialelement (L04_Listerad_spesial)
- **Fil:** `Komponenter/L04_Listerad_spesial.svg` (+ PNG)
- **Definisjon:** Alternativt innhold i nummerert liste; markør og innhold har samme godkjente varme aksent.
- **Variant:** Pause / Påminnelse
- **Eksempel:** Pause og NB! (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Akkorder (`#E5BD8D`).
- **Kilder:** [Setliste.svg](https://drive.google.com/file/d/1XWuZOuyV3dIn8HmDnMDf0a94zbd5-gSV/view), [Setliste_paaminnelse.svg](https://drive.google.com/file/d/1Z9xxEijd9-vn3MFXV_ALlJYdYf9YMP2p/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Listerad – valgbar (L05_Listerad_valgbar)
- **Fil:** `Komponenter/L05_Listerad_valgbar.svg` (+ PNG)
- **Definisjon:** Kompakt tittelrad; utvalg markeres med flate og sjekkmerke.
- **Variant:** Valgt / ikke valgt
- **Eksempel:** Sangvalg (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Hevet flate (`#403831`), Kontur (`#8F7B69`), Handling / fokus (`#E2C097`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Setliste_sangvelger.svg](https://drive.google.com/file/d/1mGzt4U0DkRgi05i5SmJXLlolaSkNmlJ0/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Listerad – separat handling (L06_Listerad_separat_handling)
- **Fil:** `Komponenter/L06_Listerad_separat_handling.svg` (+ PNG)
- **Definisjon:** Radens informasjonsflate og en egen høyrestilt handlingsknapp har separate treffområder.
- **Variant:** Ulike handlinger via ikon i raden
- **Eksempel:** Synkroniser kilde (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Synkronisering.svg](https://drive.google.com/file/d/1YMCHtfORilldAljM4prLF3DpIXl_W6EP/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.


## Verdier og inndata

### Visningspille (D01_Visningspille)
- **Fil:** `Komponenter/D01_Visningspille.svg` (+ PNG)
- **Definisjon:** Kompakt, avrundet verdiindikator. Må ikke forveksles med kontrollen som endrer verdien.
- **Variant:** Toneart / takt / capo
- **Eksempel:** Em · 4/4 (ikke del av definisjonen)
- **Farger:** Toppfelt (`#211F1D`), Appbakgrunn (`#272421`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Akkorder (`#E5BD8D`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Sangvisning_sticky_paa.svg](https://drive.google.com/file/d/1B8a29IJ7Wr13EvB43JgMrt_qvH1A9EMR/view), [Komponentkart.svg](https://drive.google.com/file/d/1uEoGh4veaSaZf3sAz2_eP5Qd_N52KNfb/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Liten verdikontroll – numerisk (D07_Liten_verdikontroll_numerisk)
- **Fil:** `Komponenter/03_Liten_verdikontroll_Capo.svg` (+ PNG)
- **Definisjon:** Kompakt kontroll med ikon og trinnvis verdi. Ingen OK/Avbryt.
- **Variant:** Lav/høy verdi, piler deaktiveres ved grenser
- **Eksempel:** Capo (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Hevet flate (`#403831`), Kontur (`#8F7B69`), Akkorder (`#E5BD8D`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Komponentkart.svg](https://drive.google.com/file/d/1uEoGh4veaSaZf3sAz2_eP5Qd_N52KNfb/view), [Ikonbibliotek.zip](https://drive.google.com/file/d/1225vuxa-p2FQKJz0ja3g4JD79zyfdhbJ/view).
- **Status:** flyttet uendret fra Opprydding.

### Liten verdikontroll – tekstlig (D08_Liten_verdikontroll_tekstlig)
- **Fil:** `Komponenter/03_Liten_verdikontroll_Toneart.svg` (+ PNG)
- **Definisjon:** Kompakt kontroll med ikon og kort tekstfelt. Ingen OK/Avbryt.
- **Variant:** Tekstlig verdi
- **Eksempel:** Toneart / Takt (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Hevet flate (`#403831`), Kontur (`#8F7B69`), Akkorder (`#E5BD8D`), Primærtekst (`#F4EDE3`).
- **Kilder:** [03_Liten_verdikontroll_Capo.svg](https://drive.google.com/file/d/1itQEOPaHf5ITyWOBlkEwwGiDhHPjsDc8/view).
- **Status:** flyttet uendret fra Opprydding.

### Tekstfelt – enlinjet (D02_Tekstfelt_enlinjet)
- **Fil:** `Komponenter/D02_Tekstfelt_enlinjet.svg` (+ PNG)
- **Definisjon:** Etikett og enlinjet felt med samme kontur- og bakgrunnssystem som andre input.
- **Variant:** Tekst / kort verdi
- **Eksempel:** Tittel / navn (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Overflate (`#322E2A`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Ny_sangbok.svg](https://drive.google.com/file/d/1mzkCq5oXqKulUrdN45juxw3S3veRdDLp/view), [Komponentkart.svg](https://drive.google.com/file/d/1uEoGh4veaSaZf3sAz2_eP5Qd_N52KNfb/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Tekstfelt – flerlinjet (D03_Tekstfelt_flerlinjet)
- **Fil:** `Komponenter/D03_Tekstfelt_flerlinjet.svg` (+ PNG)
- **Definisjon:** Flerlinjet fri tekst i større redigeringsflate. Ikke en liten verdikontroll.
- **Variant:** Vanlig tekstinnhold over flere linjer
- **Eksempel:** Notattekst (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Overflate (`#322E2A`), Kontur (`#8F7B69`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Komponentkart.svg](https://drive.google.com/file/d/1uEoGh4veaSaZf3sAz2_eP5Qd_N52KNfb/view), [Setliste_paaminnelse.svg](https://drive.google.com/file/d/1Z9xxEijd9-vn3MFXV_ALlJYdYf9YMP2p/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Valgkontroll – ett valg (D04_Valgkontroll_radio)
- **Fil:** `Komponenter/D04_Valgkontroll_radio.svg` (+ PNG)
- **Definisjon:** Radiovalg: ett alternativ om gangen. Valgt radiopunkt følger aksentrollen; kontrollfokus følger den felles, dempede tastaturmarkeringen i DESIGN. Ingen gul/gyllen aktiv- eller fokusramme rundt kontrollen.
- **Variant:** Valgt / ikke valgt
- **Eksempel:** Kun ned / Opp og ned (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Overflate (`#322E2A`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Handling / fokus (`#E2C097`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Ny_kilde.svg](https://drive.google.com/file/d/1RAUhJYx8KB9dSaG_HWIFWU27O42KQL51/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Valgkontroll – av/på (D05_Valgkontroll_bryter)
- **Fil:** `Komponenter/D05_Valgkontroll_bryter.svg` (+ PNG)
- **Definisjon:** To tilstander i kontroll knyttet til en innstilling; ikke navigasjon mellom appmoduser.
- **Variant:** På / av
- **Eksempel:** Vis akkordskjema (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Overflate (`#322E2A`), Hevet flate (`#403831`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Handling / fokus (`#E2C097`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Innstillinger.svg](https://drive.google.com/file/d/18e0FBA2Mk1lzCiopX85E52i0NPf_EvzV/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Valgkontroll – skyver (D06_Valgkontroll_skyver)
- **Fil:** `Komponenter/D06_Valgkontroll_skyver.svg` (+ PNG)
- **Definisjon:** Trinnløs eller trinnvis verdi på én akse, med synlig aktuell verdi.
- **Variant:** Aktiv posisjon
- **Eksempel:** Skriftstørrelse (ikke del av definisjonen)
- **Farger:** Toppfelt (`#211F1D`), Appbakgrunn (`#272421`), Sekundærtekst (`#C7BAA9`), Handling / fokus (`#E2C097`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Innstillinger.svg](https://drive.google.com/file/d/18e0FBA2Mk1lzCiopX85E52i0NPf_EvzV/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Sangbokvelger – kun valg (D09_Sangbokvelger_kun_valg)
- **Fil:** `Komponenter/07_Sangbokvelger_kun_valg.svg` (+ PNG)
- **Definisjon:** Åpen liste med valgte og tilgjengelige elementer. Ingen opprettelseshandling.
- **Variant:** Valgt/ikke valgt
- **Eksempel:** Velg sangbok (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Overflate (`#322E2A`), Hevet flate (`#403831`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Akkorder (`#E5BD8D`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Sangliste_sangbokvelger.svg](https://drive.google.com/file/d/1MkkUvYx9IaSEogVEa2UiydQAZRCCVApp/view).
- **Status:** flyttet uendret fra Opprydding.

### Sangbokvelger – med handling (D10_Sangbokvelger_med_handling)
- **Fil:** `Komponenter/07_Sangbokvelger.svg` (+ PNG)
- **Definisjon:** Samme valgkontroll med separat tillegghandling nederst.
- **Variant:** Valg + opprettelse; kontekstuell overskrift og integrert E03-footer ved bekreftet målvalg.
- **Sammensetning i appen:** D10 er selve popupen i Opprett i sangbok, Importer i sangbok og Slett sangbok. Headeren viser sangbokikon én gang. Ett verdifelt utvides med valglisten og Ny sangbok i samme ramme. Avbryt/Fortsett eller Avbryt/Slett bruker felles E03; det legges ingen ekstra velgerpopup eller Sangbok-overskrift rundt komponenten.
- **Eksempel:** Ny sangbok (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Overflate (`#322E2A`), Hevet flate (`#403831`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Handling / fokus (`#E2C097`), Akkorder (`#E5BD8D`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Ny_sangbok.svg](https://drive.google.com/file/d/1mzkCq5oXqKulUrdN45juxw3S3veRdDLp/view).
- **Status:** flyttet uendret fra Opprydding.


## Dialoger

### Dialog – én handling (E02_Dialog_en_handling)
- **Fil:** `Komponenter/02_Dialog_footer_1_handling.svg` (+ PNG)
- **Definisjon:** Header, kropp og helbredde-integrert footer med én primærhandling.
- **Variant:** Én handling
- **Eksempel:** Lagre (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Overflate (`#322E2A`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Handling / fokus (`#E2C097`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Ny_sangbok.svg](https://drive.google.com/file/d/1mzkCq5oXqKulUrdN45juxw3S3veRdDLp/view).
- **Status:** flyttet uendret fra Opprydding.

### Dialog – to handlinger (E03_Dialog_to_handlinger)
- **Fil:** `Komponenter/02_Dialog_footer_2_handlinger.svg` (+ PNG)
- **Definisjon:** Én primær og én sekundær handling, uten vertikal skillelinje imellom.
- **Variant:** Primær / sekundær
- **Eksempel:** Avbryt / Lagre (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Overflate (`#322E2A`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Handling / fokus (`#E2C097`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Ny_kilde.svg](https://drive.google.com/file/d/1RAUhJYx8KB9dSaG_HWIFWU27O42KQL51/view).
- **Status:** flyttet uendret fra Opprydding.

### Dialog – tre handlinger (E04_Dialog_tre_handlinger)
- **Fil:** `Komponenter/02_Dialog_footer_3_handlinger.svg` (+ PNG)
- **Definisjon:** Vertikal skillelinje bare mellom likestilte sekundærhandlinger.
- **Variant:** To sekundære + én primær
- **Eksempel:** Avbryt / Tilbake / Lagre (illustrasjon) (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Overflate (`#322E2A`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Handling / fokus (`#E2C097`), Primærtekst (`#F4EDE3`).
- **Kilder:** [02_Dialog_footer_3_handlinger.svg](https://drive.google.com/file/d/172fvhxjM0gY-ywSh0kRgzlGIxTzyinh4/view).
- **Status:** flyttet uendret fra Opprydding.

### Dialog – fullskjerm (E01_Dialog_fullskjerm)
- **Fil:** `Komponenter/E01_Dialog_fullskjerm.svg` (+ PNG)
- **Definisjon:** Hele visningsflaten, rette ytterhjørner; overskrift; scrollbart tekstfelt; integrert footer.
- **Variant:** Avbryt / Lagre
- **Eksempel:** Råtekst (ikke del av definisjonen)
- **Farger:** Toppfelt (`#211F1D`), Appbakgrunn (`#272421`), Overflate (`#322E2A`), Kontur (`#8F7B69`), Handling / fokus (`#E2C097`), Akkorder (`#E5BD8D`), Primærtekst (`#F4EDE3`).
- **Kilder:** [04_ratekst_fullskjerm.svg](https://drive.google.com/file/d/1b6QDqsGpezhXEe9N6XaXEPVu5nA2NmCM/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.


## Sanginnhold

### Akkordskjema (F01_Akkordskjema)
- **Fil:** `Komponenter/F01_Akkordskjema.svg` (+ PNG)
- **Definisjon:** Felles visningsflate for ett skjema; godkjent skråstilt pin viser sticky-tilstand.
- **Variant:** Sticky av/på; ett skjema om gangen
- **Eksempel:** Akkordprogresjon (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Overflate (`#322E2A`), Kontur (`#8F7B69`), Akkorder (`#E5BD8D`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Sangvisning_sticky_paa.svg](https://drive.google.com/file/d/1B8a29IJ7Wr13EvB43JgMrt_qvH1A9EMR/view), [Sangvisning_sticky_av.svg](https://drive.google.com/file/d/1ITO_RYH4L1rSm7_DOUCxW3dJQCyDjU3W/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Refrengstruktur (F02_Refreng)
- **Fil:** `Komponenter/F02_Refreng.svg` (+ PNG)
- **Definisjon:** Blokk med overskrift, innrykk og venstrestrek; senere henvisninger som diskret tekstkontroll.
- **Variant:** Første blokk / senere henvisning
- **Eksempel:** Refreng (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Sekundærtekst (`#C7BAA9`), Refreng (`#D9A385`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Sangvisning_sticky_paa.svg](https://drive.google.com/file/d/1B8a29IJ7Wr13EvB43JgMrt_qvH1A9EMR/view), [03_viskelaer_aktiv_alle_elementer.svg](https://drive.google.com/file/d/10haukqU8qCnjofTn1gI9eN4DrTundyIR/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Akkord og anvisning (F03_Akkord_og_anvisning)
- **Fil:** `Komponenter/F03_Akkord_og_anvisning.svg` (+ PNG)
- **Definisjon:** Inline akkord vises over riktig tekstposisjon; anvisning er eget formatert tekstelement.
- **Variant:** Akkord / anvisning
- **Eksempel:** Em / Intro (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Kontur (`#8F7B69`), Sekundærtekst (`#C7BAA9`), Akkorder (`#E5BD8D`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Sangvisning_sticky_paa.svg](https://drive.google.com/file/d/1B8a29IJ7Wr13EvB43JgMrt_qvH1A9EMR/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Dynamikk (F04_Dynamikk)
- **Fil:** `Komponenter/F04_Dynamikk.svg` (+ PNG)
- **Definisjon:** Visningsprofil i fast venstremarg; under redigering bare separate nummererte nivåmarkører.
- **Variant:** Visning / redigering
- **Eksempel:** Nivå 1–5 (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Hevet flate (`#403831`), Kontur (`#8F7B69`), Dynamikk (`#9B8573`), Sekundærtekst (`#C7BAA9`), Handling / fokus (`#E2C097`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Sangvisning_sticky_paa.svg](https://drive.google.com/file/d/1B8a29IJ7Wr13EvB43JgMrt_qvH1A9EMR/view), [03_viskelaer_aktiv_alle_elementer.svg](https://drive.google.com/file/d/10haukqU8qCnjofTn1gI9eN4DrTundyIR/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Personlig annotering (F05_Annotering)
- **Fil:** `Komponenter/F05_Annotering.svg` (+ PNG)
- **Definisjon:** Notat i egen hevet flate, uten overskrift; valgfri stiplet forankring. Gulmarkering uten tekstendring.
- **Variant:** Notat / gulmarkering
- **Eksempel:** Personlig påminnelse (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Hevet flate (`#403831`), Sekundærtekst (`#C7BAA9`), Gulmarkering (`#D6B77C`), Primærtekst (`#F4EDE3`).
- **Kilder:** [Sangvisning_sticky_paa.svg](https://drive.google.com/file/d/1B8a29IJ7Wr13EvB43JgMrt_qvH1A9EMR/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.

### Fjerningskontroll (F06_Fjerningskontroll)
- **Fil:** `Komponenter/F06_Fjerningskontroll.svg` (+ PNG)
- **Definisjon:** Global Fjern-modus gjør × synlig ved hvert fjernbart element; underliggende sangtekst berøres ikke.
- **Variant:** Ved akkord / refreng / notat / dynamikk
- **Eksempel:** Fjern (ikke del av definisjonen)
- **Farger:** Appbakgrunn (`#272421`), Hevet flate (`#403831`), Kontur (`#8F7B69`), Refreng (`#D9A385`), Handling / fokus (`#E2C097`), Akkorder (`#E5BD8D`), Primærtekst (`#F4EDE3`).
- **Kilder:** [03_viskelaer_aktiv_alle_elementer.svg](https://drive.google.com/file/d/10haukqU8qCnjofTn1gI9eN4DrTundyIR/view).
- **Status:** nytt komponentspesifikt SVG-uttrekk, ikke separat godkjent.


## Avgrensninger

- Ingen separat generell statusindikator: dette ble uttrykkelig avvist i designgjennomgangen.
- Ingen særskilt Takt-kontroll: samme generelle tekstlige verdikontroll som toneart.
- Ingen inventarliste over alle skjermbilder der en komponent brukes. Kilder er tatt med for sporbarhet, ikke som brukssteder.
- Kildeskisser fra eldre design er visuelt normalisert til godkjent palett bare i de nye uttrekkene. Ingen tidligere kilde-SVG er endret.
- Skjermspesifikke ukjente detaljer skal ikke utledes av disse eksemplene.
### Presisering – N02_Navigasjonspanel (11. november 2026)
Toppfeltet har ingen branding. Navigasjonspanelet åpnes fra høyre, under synlig header, og strekker seg til skjermens bunn. Menyknappen i headeren veksler åpen/lukket. Kilde: gjeldende godkjente toppfelt og ny eksplisitt produktavklaring.
