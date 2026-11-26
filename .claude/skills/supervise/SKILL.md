---
name: supervise
description: Leder en oppdelt issue gjennom underissuene med utførere og kontrollører.
argument-hint: '#<hovedissue>'
disable-model-invocation: true
---

# Supervisor

Du er økten selv, i hovedmappen på `master`. Du leser ikke kode eller differ og endrer aldri filer. Du stoler på CI og kontrolløren, ikke på utførerens rapport.

## Start

Tilstanden ligger i GitHub. Les hovedissuen, underissuene og PR-ene, og fortsett der arbeidet står.

Mellomgrenen står i første kommentar i hovedissuen. Finnes den ikke: lag grenen fra `origin/master`, push den og skriv navnet som første kommentar.

## Fullmakt

Bare for deg: underissuenes PR-er går mot mellomgrenen, og du merger dem med vanlig merge når CI er grønn og kontrolløren har godkjent PR-ens gjeldende hode. Samle-PR-en til `master` merger du bare etter uttrykkelig beskjed fra produktansvarlig i økten.

## Oppdrag

Pekere med fast ordlyd, uten forklaringer:

- Utfører, med Agent og `isolation: "worktree"`: «Last skillen `implementer`. Issue #N. Supervisor: ja. Målgren: X.» Ved retting i tillegg: «PR #M. Funn: se PR-kommentar.»
- Kontrollør, med Agent, `model: "fable"` og `isolation: "worktree"`: «Last skillen `kontroll`. Issue #N. PR #M.» Ny kontrollør hver runde.

## Per underissue

Ett om gangen, i rekkefølge.

1. Hopp over underissuer som er blokkert eller har `needs-info` uten svar. Har produktansvarlig svart, fjern etiketten og ta opp arbeidet.
2. Start utføreren. Vent på grønn CI.
3. Start kontrolløren og legg svaret som PR-kommentar med runde og commit.
4. Ved funn: send dem til samme utfører med SendMessage. Er den borte, får en ny utfører PR-nummeret og fortsetter på samme gren.
5. Merge, slett PR-grenen, lukk underissuet med lenke til PR-en, og rydd etter utfører og kontrollør (se **Opprydding**).
6. Kommentar i hovedissuen: underissue, PR, antall runder, funn, merknader og avklaringer. I økten én linje: «#80 er ferdig (PR #85, 1 runde). Starter #81.» eller «#80 stoppet: <grunn>. Starter #82.»

## Avslutning

Når alle underissuene er lukket:

1. Har `master` nye commits, fletter en utfører `master` inn i mellomgrenen via PR.
2. Samle-PR mot `master` med `Closes #<hovedissue>` og et sammendrag.
3. Ny kontroll av hele diffen. Funn rettes av en utfører i en PR mot mellomgrenen, med kontroll og merge som for underissuer. Oppdraget peker på hovedissuen og samle-PR-en.
4. Samle-PR-en på testadressen: Publiser og bekreft slik `docs/TESTING.md` beskriver.
5. Oppsummer til produktansvarlig: hva som er gjort, merknadene, og hva hen bør vite før merge.
6. Etter beskjed om merge: vanlig merge, slett mellomgrenen og rydd gjenværende worktrees og grener.

## Forsøk

- Ingen steg forsøkes mer enn to ganger: kontrollrunder, nye forsøk på rød CI og nye utførere for samme issue.
- En runde er én kontroll. FUNN i runde 2, eller et funn som gjentas etter utførerens innvending, gir stopp og avklaring med produktansvarlig.
- Ny utfører teller når den forrige ga opp, ikke når funn sendes til samme utfører.
- Telleren starter på nytt for hver tilbakemelding fra produktansvarlig.
- Feiler en test som endringen ikke berører, kjøres jobben én gang til før det teller som forsøk, og testen meldes som egen issue.

## Avklaringer

- Hent svaret fra `docs/` når det står der. Ellers: skriv produktspørsmålet i underissuet, gi det `needs-info`, og gå videre med det som ikke er blokkert. Når ingenting gjenstår, stopp.
- Svar fra produktansvarlig skrives i issuen før arbeidet fortsetter.
- Når du stopper og trenger svar, har meldingen overskriften «Behov for avklaring».
- Feil utenfor oppgaven blir egne issues.

## Opprydding

Agenter kan ikke fjerne egen worktree. Når en er ferdig: `git worktree unlock`, `git worktree remove --force` og slett den automatiske `worktree-*`-grenen.
