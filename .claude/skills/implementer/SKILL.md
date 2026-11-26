---
name: implementer
description: Utfører én issue til ferdig PR. Brukes når oppdraget er «Last skillen `implementer`».
argument-hint: '#<issuenummer>'
---

# Utfører

Oppdraget er issuen: teksten og kommentarene fra produktansvarlig. Beslutninger som bare står i en melding fra en annen agent, gjelder ikke før de står i issuen. Repoets regler, kommandoer og adresser står i CLAUDE.md.

Fra en supervisor får du «Supervisor: ja. Målgren: X.», og ved retting «PR #M. Funn: se PR-kommentar.» Uten det er du en enkeltjobb med målgren `master`.

## Start

1. Kjør alle kommandoer i din egen worktree, med Bash. Hovedmappen røres ikke. I enkeltjobb går du inn i en worktree med `EnterWorktree`. Følg CLAUDE.md for en ny worktree.
2. Enkeltjobb: rydd worktrees og grener fra tidligere jobber der PR-en er merget eller lukket (se **Opprydding**).
3. Finnes det en åpen PR eller gren for issuen, fortsett der. Ellers: `git fetch origin` og lag grenen fra `origin/<målgren>` før første endring.
4. Mangler issuen akseptkriterier, legg dem inn etter `docs/agents/issue-tracker.md`.

## Arbeid

- TDD der noe kan testes: én test som feiler, så retting, én om gangen. Det som ikke kan testes, rettes likevel, og PR-en sier hvordan det må prøves.
- En feilrapport fra brukertest starter med en test som gjenskaper feilen, når det lar seg gjøre.
- Kjør kontrollen før PR og de berørte e2e-filene, slik CLAUDE.md angir.

## PR

- Mot `master`: `Closes #N`. Mot en mellomgren: `Del av #N`, uten `Closes`.
- Etter hver push: vent på CI (`gh pr checks <M> --watch`). Meld aldri ferdig på rød CI.
- Rett funnene fra kontrolløren. Mener du et funn er feil, begrunn det i en PR-kommentar i stedet for å rette.

## Enkeltjobb

1. Når CI er grønn etter en push: start kontrolløren med Agent, `model: "fable"`, `isolation: "worktree"` og oppdraget «Last skillen `kontroll`. Issue #N. PR #M.» Ny kontrollør hver runde.
2. Legg svaret som PR-kommentar med runde og commit. Rydd kontrollørens worktree.
3. Funksjons- og UI-PR-er publiseres på testadressen slik CLAUDE.md angir. Publiseringen er bekreftet når publisert commit er PR-ens hode. Den kan vise gammel commit i inntil ti minutter; det er ikke rød CI.
4. Merge aldri. Meld ferdig til produktansvarlig: PR, antall runder, merknader og hva som må prøves.

## Startet av en supervisor

Start ikke kontrollør, publiser ikke og skriv ikke «Behov for avklaring». Sluttrapporten er svaret til supervisoren: PR-nummer, gren og commit, eller spørsmålet.

## Forsøk

- Ingen steg forsøkes mer enn to ganger. En runde er én kontroll. FUNN i runde 2, eller et funn som gjentas etter din innvending, gir stopp og avklaring med produktansvarlig.
- Telleren starter på nytt for hver tilbakemelding fra produktansvarlig.
- Feiler en test som endringen ikke berører, kjør jobben én gang til før det teller som forsøk, og meld testen som egen issue.

## Avklaringer

- Hent svaret fra `docs/` når det står der. Ellers: skriv produktspørsmålet i issuen, gi den `needs-info`, og fortsett med det som ikke er blokkert. Når ingenting gjenstår, stopp og meld fra.
- Svar fra produktansvarlig skrives i issuen før arbeidet fortsetter.
- I enkeltjobb har meldingen når du stopper og trenger svar, overskriften «Behov for avklaring».
- Feil utenfor oppgaven blir egne issues.

## Opprydding

En agent kan ikke fjerne sin egen worktree. Den som startet agenten, rydder når den er ferdig: `git worktree unlock`, `git worktree remove --force` og sletting av den automatiske `worktree-*`-grenen. Din egen worktree og gren rydder du når produktansvarlig melder at PR-en er merget, eller ved neste start.
