---
tags: [prometeo, moc]
created: 2026-11-09
updated: 2026-11-12
status: v1-working
last-documented-commit: f77ec93
---
# PROMETEO — Voice agent for planning projects

> [!abstract] Summary
> Local web app where you talk (or type) to **Prometeo**, a voice agent. Prometeo asks direct questions until a plan is settled, then produces deliverables: prompt, notes, `.md` plan and task list.
> Under the hood there are **two agents**: a fast **interviewer** (Sonnet) that converses and suggests MCP connections, and a deep **Architect** (Opus) that writes the deliverables in the background → [[03 Agent (agent.md)]].
> *Midnight galaxy* UI with a startup animation (the heart ignites in the dark, then the stars, with synthesized sound), an animated blue reactor-heart, cosmic buttons, comet cursor, navigation between views, a voice catalog with samples, a FAQ view where Prometeo answers common questions with pre-recorded audio, and a Settings menu (voice, CPU/GPU, models, ES/EN interface language, colour theme Original/Rosa).
> The **Forja** (agent manager, in the top nav) runs the generated prompts and free tasks in real Claude Code terminals inside the UI, with star-named agents (Orión, Centauri, Sol…), Claude usage meters and Prometeo as the orchestrator that validates and asks for English task notes in each project's vault → [[12 Agent manager]].
> Each project is `<date>-<name>/` (PROMETEO's files) with `<name>/` inside (`code/` + `obsidian-vault/`), ready to become a repo on its own → [[02 Repo structure]].

> [!info] Formerly called ORION
> Renamed to PROMETEO on 2026-11-09. Repo and vault already renamed.

> [!note] Language
> This vault is written in English because it is context for Claude. The app itself stays in Spanish: UI (with an EN switch), voice, agent prompts and skills. Spanish UI strings and identifiers are quoted as they are.

## Decisions made
- **100 % open-source, local voice:** faster-whisper (STT), Kokoro ONNX (TTS v1), Silero VAD in the browser. Chatterbox later for voice cloning. → [[08 Open-source voice stack]]
- **Brain:** Claude through **the user's subscription**, via the Claude Agent SDK, which reuses the `claude login` session. No API key needed. **Sonnet 5.5** (effort `low`) for the interviewer and **Opus 5.5** (effort `high`) for the Architect.
  > [!warning] Personal use only
  > If distributed to other users, Anthropic's terms require authenticating with an API key.
- **Deployment:** local / self-hosted. Projects are stored on disk as folders of `.md` files.
- **Input:** voice (hands-free or push-to-talk) and a text box.
- **Dev machines:** one with Intel Iris Xe (everything on CPU) and one with an **NVIDIA RTX 4060**, where Whisper can run on the GPU. CPU/GPU is chosen in Settings and stored per machine. Python 3.12 via `uv`.
- **Linux and Windows, one codebase:** everything OS-specific lives in `backend/app/plataforma.py`. Linux keeps `git clone` + `./bin/prometeo`; Windows installs with a one-line `install.ps1` that downloads the GitHub release zip (prebuilt frontend, no Node). CI runs on Ubuntu and Windows. First release: **v0.1.0** (2026-11-10). A collaborator runs it on Windows 11 with an RTX 3050 → [[10 Implementation decisions]]
- **Who it's for:** personal use and friends, each with their own Claude account. Anthropic does not allow third-party apps to offer claude.ai login to their users without approval (API key instead); the repo is public but not promoted. Pending: optional API key mode.

## Index
1. [[01 Architecture]]
2. [[02 Repo structure]]
3. [[03 Agent (agent.md)]]
4. [[04 Voice (voice.md)]]
5. [[05 Skills]]
6. [[06 UI Midnight Galaxy]]
7. [[07 Phases and roadmap]]
8. [[08 Open-source voice stack]]
9. [[09 Logo prompts]]
10. [[10 Implementation decisions]]
11. [[11 Prometeo rebrand prompt]]
12. [[12 Agent manager]]

## Links
- Figma, UI views: https://www.figma.com/design/ieSA764l6YXaKg9c4LgdYO
- Code: `~/Work/prometeo`
- GitHub (public): https://github.com/manuelgraya/prometeo
