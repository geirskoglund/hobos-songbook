# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase. Single-context repo.

## Before exploring, read these

Read targeted sections, not whole files; the documents are large.

- **`GLOSSARY.md`** at the repo root, if it exists.
- **`docs/REQUIREMENTS.md`**: product requirements (stable requirement IDs).
- **`docs/DECISIONS.md`**: current decisions with stable IDs (D01, D02, …). This is the decision log; read the decisions that touch the area you're about to work in.
- **`docs/DESIGN.md`**: binding design system and component IDs (e.g. L05, D10).
- **`docs/ARCHITECTURE.md`**: technical structure.

If `GLOSSARY.md` doesn't exist, **proceed silently**. Don't flag its absence; the `/domain-modeling` skill creates it lazily when terms actually get resolved.

## Decisions live in DECISIONS.md, not `docs/adr/`

This repo does not use `docs/adr/`. When a skill would record an ADR, add or update a decision in `docs/DECISIONS.md` instead, using the next free D-number. Product rules are stated in exactly one place; history belongs in git and issues, not in the docs. Update the docs only when a product rule actually changes.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md` and the product docs. Don't drift to synonyms. Preserve stable IDs (requirements, D-decisions, component IDs).

If the concept you need isn't defined yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag decision conflicts

If your output contradicts an existing decision, surface it explicitly rather than silently overriding:

> _Contradicts D06 (bevar data ved usikkerhet), but worth reopening because…_
