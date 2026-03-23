# Nordic Studio

A macOS desktop AI workspace powered by OpenClaw + Gemini. Built as a WKWebView app with a Vite/Vanilla JS frontend.

## Features

- **Chat** — stream conversations with Gemini 2.5 Flash via the OpenClaw gateway
- **Mindmap** — visual skill/agent graph; pan, zoom, click categories to expand skills
- **Skill management** — enable/disable skills, set API keys, install from ClawHub
- **Data Sources** — add custom URLs so OpenClaw navigates them on demand
- **Session history** — each session gets a unique key; browse past chats in the History panel
- **Presence monitor** — see when Claude Code is active and what it's doing

## Tech stack

- **Frontend**: Vanilla JS + Vite, Tailwind CSS (CDN), Material Symbols
- **Gateway**: OpenClaw WebSocket v3 (`ws://127.0.0.1:18789`)
- **macOS wrapper**: Swift / WKWebView with custom `app://` URL scheme

## Dev setup

```bash
cd nordic-studio
npm install
npm run dev        # dev server at http://localhost:3000
npm run build      # production build → dist/
```

After building, sync to Xcode:
```bash
cp -r dist/* ../NordicStudio/NordicStudio/web/
```

## Project structure

```
src/
  main.js      — all UI logic (chat, mindmap, sessions, skills, sources)
  gateway.js   — OpenClaw WebSocket client
index.html     — app shell
```

## Related repo

See [openclaw-setup](https://github.com/Ajitesh-lab/openclaw-setup) for gateway configuration.
