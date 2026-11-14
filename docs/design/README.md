# Organisk – designreferanser

Godkjent designgrunnlag, komponentkart med 32 enkeltkomponenter og ikonregister v3 er bindende for alt UI-arbeid. Grunnlaget er levert med issue #23; nye eller avvikende kontrolltyper krever uttrykkelig produktavklaring. `grunnlag/` beskriver farger og typografi, `komponenter/` inneholder kart, manifest og enkelt-SVG-er, og `ikoner/` inneholder ikonregister og originalfiler. Repoet bevarer de redigerbare SVG-ene; PNG-forhåndsvisninger og det redundante ZIP-arkivet finnes i issuevedleggene. Individuelle SVG-er er geometrisk referanse; eksempelinnhold bestiller ikke nye funksjoner.

Gjeldende avklaringer: F06s kryss er historisk referanse; sangredigeringen bruker long press/outline og Fjern på ett valgt element. F05 følger notatet under flytting. Små verdikontroller er alltid énlinjet. Øvrige avklaringer: bare mørkt tema i v1; hovedmenyen bruker hamburger; Råtekst har Avbryt/Lagre; dialogfootere med 1/2/3 handlinger gjenbrukes, og sangens små verdiredigerere bruker D07/D08 uten OK/Avbryt. Innstillinger vedlikeholdes i appen. Historiske Drive-lenker i katalogen er kildehenvisninger, ikke et parallelt dokumentsett.

Runtimeikonene i `assets/ui-icons/` følger de bevarte referanseformene og brukes gjennom appens felles ikonregister. Fontfiler og lisenser ligger i `assets/fonts/` (Fontsource Inter, Gentium Book Plus og Cousine, latin med norske tegn). Referansearkene er ikke runtime-ressurser.

Sangbøker gjenbruker Setlisters L02, H01/H04 og felles D02/E03-navnedialog. D09 og D10 deler velger og L05-rader; D10 har separat Ny sangbok-handling. Opprett/Importer har D10 med Avbryt/Fortsett før Råtekst/filvalg, og bok med sanger krever D10-mål før sletting. Sangbokikonet brukes i hovedmenyen, filterutløseren og begge popupoverskrifter. Menyrekkefølgen er Sanger, Setlister, Synkronisering, Sangbøker, Filer, bunnforankret Innstillinger. Gjeldende flyter og fokusregler står i [DESIGN](../DESIGN.md).

## Navneindeks

Navn og stabile ID-er følger komponentbiblioteket. Arbeidsreglene står i [DESIGN](../DESIGN.md#bruk-av-designsystemet).

| Navn i komponentbiblioteket | Stabil ID | Visuell referanse |
| --- | --- | --- |
| Toppfelt | `N01_Toppfelt` | [SVG](komponenter/Komponenter/N01_Toppfelt.svg) |
| Navigasjonspanel | `N02_Navigasjonspanel` | [SVG](komponenter/Komponenter/N02_Navigasjonspanel.svg) |
| Flytende handling | `H01_Flytende_handling` | [SVG](komponenter/Komponenter/01_Flytende_plussknapp.svg) |
| Verktøyknapp | `H02_Verktoyknapp` | [SVG](komponenter/Komponenter/04_Verktoyknapp.svg) |
| Fanevelger | `H03_Fanevelger` | [SVG](komponenter/Komponenter/05_Fanevelger.svg) |
| Kontekstmeny | `H04_Kontekstmeny` | [SVG](komponenter/Komponenter/06_Kontekstmeny.svg) |
| Listerad – tittel og metadata | `L01_Listerad_tittel_metadata` | [SVG](komponenter/Komponenter/L01_Listerad_tittel_metadata.svg) |
| Listerad – tittel og antall | `L02_Listerad_tittel_antall` | [SVG](komponenter/Komponenter/L02_Listerad_tittel_antall.svg) |
| Listerad – nummerert | `L03_Listerad_nummerert` | [SVG](komponenter/Komponenter/L03_Listerad_nummerert.svg) |
| Listerad – spesialelement | `L04_Listerad_spesial` | [SVG](komponenter/Komponenter/L04_Listerad_spesial.svg) |
| Listerad – valgbar | `L05_Listerad_valgbar` | [SVG](komponenter/Komponenter/L05_Listerad_valgbar.svg) |
| Listerad – separat handling | `L06_Listerad_separat_handling` | [SVG](komponenter/Komponenter/L06_Listerad_separat_handling.svg) |
| Visningspille | `D01_Visningspille` | [SVG](komponenter/Komponenter/D01_Visningspille.svg) |
| Liten verdikontroll – numerisk | `D07_Liten_verdikontroll_numerisk` | [SVG](komponenter/Komponenter/03_Liten_verdikontroll_Capo.svg) |
| Liten verdikontroll – tekstlig | `D08_Liten_verdikontroll_tekstlig` | [SVG](komponenter/Komponenter/03_Liten_verdikontroll_Toneart.svg) |
| Tekstfelt – enlinjet | `D02_Tekstfelt_enlinjet` | [SVG](komponenter/Komponenter/D02_Tekstfelt_enlinjet.svg) |
| Tekstfelt – flerlinjet | `D03_Tekstfelt_flerlinjet` | [SVG](komponenter/Komponenter/D03_Tekstfelt_flerlinjet.svg) |
| Valgkontroll – ett valg | `D04_Valgkontroll_radio` | [SVG](komponenter/Komponenter/D04_Valgkontroll_radio.svg) |
| Valgkontroll – av/på | `D05_Valgkontroll_bryter` | [SVG](komponenter/Komponenter/D05_Valgkontroll_bryter.svg) |
| Valgkontroll – skyver | `D06_Valgkontroll_skyver` | [SVG](komponenter/Komponenter/D06_Valgkontroll_skyver.svg) |
| Sangbokvelger – kun valg | `D09_Sangbokvelger_kun_valg` | [SVG](komponenter/Komponenter/07_Sangbokvelger_kun_valg.svg) |
| Sangbokvelger – med handling | `D10_Sangbokvelger_med_handling` | [SVG](komponenter/Komponenter/07_Sangbokvelger.svg) |
| Dialog – én handling | `E02_Dialog_en_handling` | [SVG](komponenter/Komponenter/02_Dialog_footer_1_handling.svg) |
| Dialog – to handlinger | `E03_Dialog_to_handlinger` | [SVG](komponenter/Komponenter/02_Dialog_footer_2_handlinger.svg) |
| Dialog – tre handlinger | `E04_Dialog_tre_handlinger` | [SVG](komponenter/Komponenter/02_Dialog_footer_3_handlinger.svg) |
| Dialog – fullskjerm | `E01_Dialog_fullskjerm` | [SVG](komponenter/Komponenter/E01_Dialog_fullskjerm.svg) |
| Akkordskjema | `F01_Akkordskjema` | [SVG](komponenter/Komponenter/F01_Akkordskjema.svg) |
| Refrengstruktur | `F02_Refreng` | [SVG](komponenter/Komponenter/F02_Refreng.svg) |
| Akkord og anvisning | `F03_Akkord_og_anvisning` | [SVG](komponenter/Komponenter/F03_Akkord_og_anvisning.svg) |
| Dynamikk | `F04_Dynamikk` | [SVG](komponenter/Komponenter/F04_Dynamikk.svg) |
| Personlig annotering | `F05_Annotering` | [SVG](komponenter/Komponenter/F05_Annotering.svg) |
| Fjerningskontroll | `F06_Fjerningskontroll` | [SVG](komponenter/Komponenter/F06_Fjerningskontroll.svg) |

Farge- og typografiregler: [designgrunnlag](grunnlag/01_Designgrunnlag_oppdatert.svg).
Komponentdefinisjoner og varianter: [katalog](komponenter/Kilder_og_komponentdefinisjoner.md) og [manifest](komponenter/komponentmanifest.json).
Ikonnavn, visningstekst og betydning: [ikonregister v3](ikoner/ikonregister_v3.md).
