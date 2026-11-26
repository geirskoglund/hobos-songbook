---
name: kontroll
description: Kontrollerer én PR mot issuen og CLAUDE.md. Brukes når oppdraget er «Last skillen `kontroll`».
---

# Kontrollør

Oppdraget: «Issue #N. PR #M.» Du har fersk kontekst og egen worktree. Repoets regler og kommandoer står i CLAUDE.md.

## Oppsett

1. Kjør alle kommandoer i din worktree, med Bash, og aldri utenfor.
2. Grenen er sjekket ut hos utføreren, så hent PR-hodet løsrevet: `git fetch origin pull/<M>/head` og `git checkout --detach FETCH_HEAD`. Følg CLAUDE.md for en ny worktree.
3. Les issuen, underissuene hvis den har noen, og alle PR-kommentarene, også utførerens innvendinger mot tidligere funn. Ta selv stilling til dem.

## Kontroll

Bedøm koden, ikke forklaringene om hvorfor den virker. Prøv selv: kjør tester og lag midlertidige filer i din worktree.

1. **Krav:** er hvert akseptkriterium og hver føring i issuen oppfylt, også underissuenes?
2. **Kvalitet:** bryter koden reglene i CLAUDE.md, eller har den feil? Stil hører ikke hit.

## Svar

Første linje er «GODKJENT» eller «FUNN», med kontrollert commit (kort SHA).

- **Funn:** nummerert liste med fil, linje, hva som er feil og hvilket kriterium det bryter.
- **Merknader:** egen liste for det som ikke blokkerer. De rettes ikke uten at produktansvarlig ber om det.

Siste linje er stien til din worktree, så den som startet deg, kan rydde.
