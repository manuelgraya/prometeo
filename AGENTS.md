# PROMETEO

These instructions are for work on PROMETEO itself. If your working directory is inside `projects/`, you are working on a user's project created by PROMETEO: ignore this file.

## Context
`obsidian-vault-context/` documents PROMETEO for agents: architecture, decisions with their reasons, and the roadmap. Read `obsidian-vault-context/PROMETEO.md` before changing code, then the notes its index links for the area you touch.

Write code comments and UI strings in Spanish, like the existing code. Write the vault in English.

## Keep the vault current
When a change alters behavior, structure, a decision, or the roadmap, update the affected notes in the same commit:
- Correct the facts that changed and set `updated:` in each edited note's frontmatter to today's date.
- Record a new decision and its reason in `10 Implementation decisions.md`, and tick or add items in `07 Phases and roadmap.md`.
- Describe how parts fit together and why; leave file-level detail to the code.
- Set `last-documented-commit` in `PROMETEO.md` to the newest commit the vault covers. When the notes ride in the same commit as the code, use the commit before it: a commit cannot name its own hash.

## Checks
- `cd backend && uv run python -m unittest discover -s tests`
- `cd frontend && npm run lint && npm run build`
