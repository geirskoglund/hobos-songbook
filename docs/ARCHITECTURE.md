# Arkitektur

> **Her står:** det koden ikke sier selv, det vil si lagdeling og grenser, kanaler, offline, Dropbox-strukturen og regler for synk og lagring der et brudd kan koste brukerdata.
>
> **Ikke her:** hva modulene gjør, oppførsel i brukergrensesnittet eller begreper.

## Lag og avhengigheter

Statisk HTML, CSS og TypeScript bygget med Vite. Ingen backend, skydatabase, Dropbox-SDK eller CDN ved kjøring.

| Mappe | Ansvar | Grense |
| --- | --- | --- |
| `src/core/` | Typer, feil og små felles konstanter og fabrikker: sangdata, lokal journal, Dropbox-kontrakt, faste stier og lagringsnøkler, feilkoder, filgrenser | Importerer ingen andre lag |
| `src/domain/` | Regler for sang, ChordPro-tolkning, personlig lag, sangbok, setliste | Ingen DOM, lagring eller Dropbox |
| `src/storage/` | IndexedDB og localStorage per kanal, unntatt synkens egne poster, som `src/sync/` eier | Ingen nettkall |
| `src/adapters/` | Dropbox: OAuth/PKCE, HTTP, ratebegrensning | Ingen domenelogikk |
| `src/sync/` | Synk-motor, synktilstand og journalens økter i IndexedDB, Dropbox-plan, diagnostikk | Ingen DOM |
| `src/ui/` | Ren DOM uten rammeverk | Eier visning, ikke lagringsbetydning |
| `scripts/`, `.github/workflows/` | Bygg og publisering | Se [TESTING](TESTING.md) |

Tabellen lister lagene i `src/` med laveste lag først. Et lag importerer bare fra seg selv og lavere lag, og alle lag unntatt `core` kan bruke `src/environment.ts`. ESLint håndhever regelen (`eslint.config.mjs`).

Domenet importerer aldri Dropbox. Originalteksten er autoritativ; parserens struktur og DOM-en er avledet og skrives aldri tilbake som original. Kildehandlinger endrer avgrensede tekstområder og bevarer BOM, linjeskift, ukjente direktiver og uberørt whitespace.

## Felles UI og layout

Én implementasjon per kontrolltype, brukt fra alle steder med innhold, tilstand og callbacks som parametere. Felleskomponenten eier form, tilgjengelighet og betjening; bruksstedet eier domenehandlingen. Varianter bygges ved komposisjon, ikke lokale kopier.

| Fil | Eier |
| --- | --- |
| `src/theme.css` | Farger, fonter, bredder, dialogmål |
| `src/ui/layout.ts` | Aktiv hovedflate, viewport, målt header- og verktøylinjehøyde |
| `src/ui/controls.ts`, `dialog.ts` | Knapper, felt, brytere, dialogramme og -livssyklus |
| `src/ui/list-controls.ts` | Listerader, overskrifter og velgere (H01/H04, L01/L05, D09/D10) |
| `src/ui/app-interactions.ts` | Tastaturmarkering (`data-keyboard-focus` på roten) og appens egen tekst- og kontekstbetjening |

Normative mål står i [DESIGN](DESIGN.md).

## Kanaler

Produksjon og test er to fullt adskilte PWA-er på samme origin (`geirskoglund.github.io`).

| Egenskap | Produksjon | Test |
| --- | --- | --- |
| Sti og worker-scope | `/hobos-songbook/app/` | `/hobos-songbook/test/` |
| Appnavn | Hobo's Songbook | Hobo's Songbook Test |
| Namespace (IndexedDB, cache, localStorage-prefiks) | `hobos-songbook-production` | `hobos-songbook-test` |
| Dropbox-app | `hobos.songbook.app` | `hobos.songbook.test.app` |
| Dropbox klient-ID | `9hivdq3nxrgtquz` | `le5cddh388klcjz` |

- `src/environment.ts` er eneste kilde for kanalens identitet. SHA og PR er bare byggmetadata; ingen lagringsnavn følger dem.
- Navnene hindrer kollisjon, men skript på samme origin er ikke sikkerhetsisolert fra hverandre. Data kopieres aldri automatisk mellom kanalene.
- Ingen root-worker for `/hobos-songbook/`.

## Lokal lagring

IndexedDB har skjemaversjon 4 med lagrene `songs`, `personal`, `songbooks`, `setlists` og `sync`.

- Oppgraderinger er additive. Eldre versjoner oppgraderes uten nullstilling. Ukjent nyere versjon eller avvikende nøkler avvises uten å slette noe.
- Ingenting slettes ved appstart, oppdatering eller publisering.
- Lokale skrivinger til sang, personlig lag og bok tar `sync` med i samme transaksjon og øker en varig generasjon. Lagring er bekreftet først ved `oncomplete`.
- `add` overskriver aldri en eksisterende sang. Sletting av bok etterlater tombstone med ID og navn.
- Personlig lag (`personal`, format 3) ligger separat fra originalen. Ankre er logiske linjer (`line:N`) og UTF-16-tegnspenn, uten kopi av originaltekst. Ved tekstendring går laget gjennom `reconcilePersonal`: notater beholder posisjon, sikre markeringer justeres og usikre fjernes.

localStorage-nøkler, alle med prefikset `<namespace>:`:

| Nøkkel | Innhold |
| --- | --- |
| `display` | Skriftstørrelse, skjema- og dynamikkvisning, tema |
| `songbook-filter` | Valgt sangbok; tom streng betyr Alle |
| `sync-diagnostics-v1` | Inntil 20 lokale synkrapporter |
| Autentiseringsnøkkel | Access- og refresh-token, aldri andre steder |

## Offline og oppdatering

- Workbox genererer én `sw.js` per kanal med alt appskallet i precache, også fonter og ikoner. Ingen runtime-cache av Dropbox eller eksterne tjenester. Bred `cleanupOutdatedCaches` er av.
- Appen lover offline først når workeren er ferdig installert. Manglende workerstøtte gir ingen falsk klarstatus.
- `src/app-updates.ts` ser etter oppdatering ved oppstart, fokus, nettilbakekomst og hvert minutt mens appen er synlig. `updateViaCache: none`.
- Varsel om ny versjon krever at den ventende workeren melder en annen SHA eller PR enn den som kjører (`src/worker-build.ts`). `waiting` eller `controllerchange` alene er ikke nok.
- Aktivering krever eksplisitt trykk (`SKIP_WAITING`). Omlasting venter på lagringskøen og stopper ved ulagret arbeid eller lagringsfeil.
- `src/ui/update-view.ts` lagrer et engangsøyeblikksbilde av visningen i `history.state`, slik at brukeren kommer tilbake til samme side, sang og lesested. Originaltekst kopieres ikke dit.

## Privat Dropbox-synk

### Tilgang

Begge Dropbox-appene er App Folder med `account_info.read`, `files.metadata.read`, `files.content.read`, `files.content.write`, `sharing.read` og `sharing.write`. Redirect er kanalens eksakte adresse.

- OAuth med PKCE S256 og offentlig klient-ID. Verifier og state ligger i `sessionStorage` i ti minutter og brukes én gang.
- Tokens skrives aldri til synkfiler, byggmetadata eller worker-cache. Fornyelse serialiseres mellom faner.
- Bare bekreftet `invalid_access_token` eller `invalid_grant` fjerner lagret tilkobling. HTTP 401 uten slik kode, 403, serverfeil og venting beholder den.
- Avslag eller kontobytte ved etterfølgende samtykke til delingstilgang beholder vanlig filtilgang.

### Mappestruktur i app-mappen

```text
/Songbooks/<sangbok>/Private/<sang>.cho   egne sanger
/Songbooks/<sangbok>/Shared/<sang>.cho    publiserte sanger
/Songbooks/<sangbok>/Import/              opprettes for hver sangbok
/Songbooks/<sangbok>/Import/<import>/     kopi av importens delte mappe med kildens undermapper
/Songbooks/<sangbok>/Originals/<fil>      uendret kopi av importert fil med annen endelse
/Deleted/<sangbok> YYYY-MM-DD HHmm/       arkiv av slettet bokmappe
/.app/library.json                        manifest: bøker, sanger, fil- og mappekoblinger, slettemarkører
/.app/songs/<sang-ID>.json                personlig lag og original-rev/SHA-256
/.app/mutation.json                       delt skrivevern (CAS)
/.app/upload-index.json                   proveniens for opplastinger som ikke er ferdige
/.app/uploads/<operasjons-ID>.cho         midlertidig fil før plassering
/.app/sync-errors.json                    opplastede diagnoserapporter
/.app/imports.json                        registrerte importer: navn, delingslenke og sangbok-ID
/.app/import-state.json                   per import: kildens fil-ID-er koblet til sang-ID og kopi, og en cursor per kildemappe
```

- Sangens ID og personlige lag skrives aldri inn i `.cho`-filen.
- `imports.json` skrives alene med forventet rev, uten skrivevernet, og leses på nytt etter hver fullført manuell Synkroniser. Feltreglene sjekkes mot den ferskeste listen før skriving.
- Nye filnavn kommer fra importert filnavn eller sangtittel. Kollisjoner (uavhengig av store/små bokstaver og NFC) får `(2)`, `(3)` osv. Ingen fil overskrives.
- Manuell Synkroniser oppdager nye `.cho`-filer i Private og nye mapper under `/Songbooks/`. En omdøpt kjent mappe følges via Dropbox-ID og blir navneendring på samme bok. Andre mapper skannes ikke.
- Filer over 10 000 000 byte hoppes over. De regnes aldri som slettet.

### Lokal synktilstand

Lageret `sync` har `private-local-v1` (generasjon, slettemarkører, aktive økter), `private-account-v1:<konto-ID>` (felles basis, rev-er, metadataindeks, reservasjoner, konfliktvalg, journal) og `imports-v1:<konto-ID>` (sist leste importliste, vist uten nett). Kontotilstanden har også `sharedImports`: sist leste `import-state.json` og hver imports hentestatus på denne enheten. Konto-ID er kontogrensen; e-post er bare visningstekst. `bindings` oversetter mellom lokale ID-er og sky-ID-er, slik at lokale poster og setlister beholder sine referanser.

### Regler synk-motoren må holde

Dropbox har ingen transaksjon over flere filer. Reglene under erstatter den.

**Identitet og sletting**

1. Første samordning kobler bare entydige par: bøker med samme normaliserte navn, sanger med samme ikke-tomme opprinnelige filnavn i samme bok. Ingen matching på tittel og ingen gjetning ved flere kandidater.
2. Fravær er ikke slettingsbevis. Tilgangsfeil, ufullstendig paginering, store filer og manglende manifestoppføring sletter aldri lokale data.
3. Bekreftet fysisk sletting av en kjent sangfil eller bokmappe fjerner sangen og dens personlige lag lokalt, med mindre samme sang-ID er bekreftet i en aktiv bok.
4. Flytting mellom Private og Shared beholder identiteten. Flytting til Originals tar sangen ut av appen, men filen beholdes.
5. En slettet bokmappe arkiveres i `/Deleted/` først når alle sangoverføringer er bekreftet i manifestet.

**Skriving**

6. Alle filskrivinger bruker forventet rev eller streng add. Overskriving er aldri tillatt.
7. Muterende synk tar skrivevernet i `/.app/mutation.json` før den leser fersk basis, og slipper det først etter manifestkvittering. Andre enheter venter. Vernet virker bare mellom klienter som følger protokollen.
8. Rekkefølgen er sangfil, så personlig sidefil, så manifest. Manifestet kvitterer bare ferdig filarbeid.
9. Nye filer lastes først opp til en unik sti i `/.app/uploads/`, registreres i `upload-index.json`, og flyttes så til målmappen med `autorename:false`. Andre enheter tolker dermed ikke en halvferdig fil som en ny sang.
10. Flytting og mappeoppretting skjer med Dropbox-ID og mappe-ID-relative mål, slik at omdøping underveis ikke flytter feil.

**Avbrudd og nye forsøk**

11. Intensjoner, reserverte ID-er og navn, økt-ID-er og jobb-ID-er journalføres før nettkallet. Et avbrutt eller tapt svar kan da prøves igjen uten dubletter.
12. Et kall med ukjent utfall regnes som sendt. Det spilles ikke av på nytt fra ID, men avklares mot jobbstatus eller faktisk plassering i en fersk metadataindeks. Til det er avklart, beholdes skrivevernet.
13. Konto, synkøkt og lokal generasjon kontrolleres før og etter hvert nett-trinn og i den lokale commit-transaksjonen. Et gammelt svar kvitterer aldri nyere lokale endringer.
14. Nettventing skjer aldri inne i en IndexedDB-transaksjon.

**Konflikter**

15. Hver identitet vurderes treveis mot felles basis. Hele det personlige laget sammenlignes. Ulike versjoner krever uttrykkelig valg; uavhengige lag får ingen oppdiktet felles basis.
16. Et original- og personvalg fra ulike grunnlag går én gang gjennom `reconcilePersonal`. Et kopivalg remapper ankrene.

**Import**

17. Importerte sanger står i manifestet som andre sanger, med `origin.kind: external` og import-ID som `sourceId`. Synken laster dem ned og synker personlig lag, men laster aldri opp innholdet og flytter dem aldri. Bare hentingen skriver i `Import/<import>/`.
18. Henting skjer bare ved manuell Synkroniser, under skrivevernet, etter at sangbokmappene finnes og før sangene synkes. Hver kildemappe fortsettes fra sin cursor, fordi Dropbox ikke lister en delingslenke rekursivt. Uendret kilde gir ett kall per mappe og ingen nedlasting.
19. En kopi er oppdatert når kildens `content_hash` og kopiens rev er de samme som da appen skrev den. Ellers lastes kildefilen ned og skrives med forventet rev eller streng add.
20. Kildens fil-ID følger filen ved navneendring og flytting. En ny fil med samme sti som en fjernet fil får samme sang-ID. En fil som forsvinner fra kilden, beholdes.
21. `import-state.json` skrives før manifestet, så et avbrudd aldri gir to sanger for samme kildefil.
22. Svar fra delingslenken stopper bare den ene importen. Nett-, tilgangs- og ratefeil stopper synken som ellers.

### Når synk kjører

- Første tilkobling samordner med nedlasting. Senere oppstart og nettretur kan bare laste opp ventende arbeid.
- Bare manuell Synkroniser laster ned og gjenåpner utsatte konflikter. Ingen timer, polling eller bakgrunnsnedlasting.
- Web Locks serialiserer synk mellom faner. Uten Web Locks stopper Dropbox-arbeidet, men lokal bruk fortsetter.
- En åpen sangøkt pauser synk. En forlatt økt etter krasj krever vanlig manuell synk før automatisk opplasting fortsetter.

### Dropbox-grenser

- Batcher med opptil 100 oppføringer (`move_batch_v2`, `delete_batch`, `create_folder_batch`, `upload_session/finish_batch_v2`). Append-grupper holdes under 150 MiB. HTTP 200 kan inneholde delvise feil per oppføring.
- Inntil fire samtidige lesinger eller opplastinger. Etter HTTP 429 én om gangen resten av kjøringen.
- Ved HTTP 429 eller skrivelås følges `Retry-After`. Høyst to ekstra forsøk per forespørsel og 30 s samlet venting per kjøring; deretter SYNC-007.
- 30 s tidsgrense per nettkall. Statussjekk av en batchjobb høyst seks ganger innenfor 5,5 s.

Kontrakten er Dropbox' egen dokumentasjon: [Performance](https://docs.dropboxapi.com/dropbox-api/docs/performance), [API-spec](https://github.com/dropbox/dropbox-api-spec) og [stityper](https://docs.dropboxapi.com/dropbox-api/docs/technical-reference/request-response-formats).

### Diagnostikk

- Feilkodene `SYNC-001` til `SYNC-024` er konstanter i [failure.ts](../src/core/failure.ts). `SYNC-023` er ubrukt og gjenbrukes ikke.
- En rapport inneholder tilfeldig hendelses-ID, tid, byggidentitet, feilkode, steg, siste 30 API-operasjoner uten argumenter, Dropbox-request-ID-er og filtrerte plattformopplysninger.
- Rapporten inneholder aldri tokens, konto-ID, e-post, sang- eller boknavn, private stier, rå feiltekst eller API-svar.
- Opplasting til `/.app/sync-errors.json` går bare til kontoen som laget rapporten, og påvirker ikke synkresultatet.
