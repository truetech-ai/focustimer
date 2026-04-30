# PomodoroPet

Arcade-style Pomodoro focus timer with animated GIF break screens and AI background removal.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue)
![Electron](https://img.shields.io/badge/electron-33-blue)
![React](https://img.shields.io/badge/react-18-61dafb)

## Features

- 25 / 5 / 15 min Pomodoro timer with session tracking
- Animated GIF break screen with optional AI background removal
- Timer persists through Windows screen lock
- Neon retro aesthetic

## Download

Grab the latest installer from [Releases](../../releases).

- **Windows** — `PomodoroPet Setup x.x.x.exe`
- **Linux** — `PomodoroPet-x.x.x.AppImage`

> **Windows note:** SmartScreen may warn "unrecognized app" — click **More info → Run anyway**. App is unsigned.

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org) v18+
- npm

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/focustimer.git
cd focustimer/electron
npm install
```

### Run (dev mode)

```bash
npm run dev
```

Opens Vite dev server + Electron window with hot reload.

### Build installer

```bash
npm run dist
```

Output in `release/`:
- `win-unpacked/` — portable, no install needed
- `PomodoroPet Setup x.x.x.exe` — NSIS installer (Windows)
- `PomodoroPet-x.x.x.AppImage` — portable (Linux)

> **Windows build note:** If you get a symlink error during build, enable **Developer Mode** in Windows Settings → System → For developers, then retry.

---

## Usage

| Action | Description |
|---|---|
| Click timer ring | Start / pause |
| Reset button | Reset to 25 min |
| Add GIF | Pick any `.gif` or `.webp` file for break screen |
| AI mode | Removes GIF background (downloads ~35 MB model on first use) |
| Color-key mode | Fast background removal by color sampling |

---

## Project Structure

```
focustimer/
├── electron/
│   ├── main/
│   │   ├── main.cjs        # Electron main process
│   │   └── preload.cjs     # IPC bridge
│   ├── src/
│   │   ├── App.tsx         # Timer UI + logic
│   │   ├── components/     # BreakCanvas, GifPicker
│   │   └── hooks/          # useGifFrames (GIF parsing + BG removal)
│   └── public/gifs/        # Bundled fallback GIFs
└── .github/workflows/
    └── build.yml           # CI: auto-builds Windows + Linux on tag push
```

---

## Releases (CI)

Push a version tag to trigger automatic builds for both platforms:

```bash
git tag v2.0.0
git push origin v2.0.0
```

GitHub Actions builds Windows `.exe` and Linux `.AppImage`, attaches both to the release.

---

## Tech Stack

- [Electron](https://www.electronjs.org) — desktop shell
- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org) — UI
- [Vite](https://vitejs.dev) — bundler
- [gifuct-js](https://github.com/matt-way/gifuct-js) — GIF parsing
- [@imgly/background-removal-node](https://github.com/imgly/background-removal-node) — AI background removal
