# PomodoroPet

Arcade-style Pomodoro focus timer with AI posture detection, animated GIF break screens, and session stats.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Electron](https://img.shields.io/badge/electron-33-blue)
![React](https://img.shields.io/badge/react-18-61dafb)

## Download

### Windows

[![Download for Windows](https://img.shields.io/badge/Download-Windows%20Installer-39ff14?style=for-the-badge&logo=windows)](https://github.com/truetech-ai/focustimer/releases/download/v2.1.2/PomodoroPet.Setup.2.0.1.exe)

> SmartScreen may warn "unrecognized app" — click **More info → Run anyway**. App is unsigned.

---

## Features

- **Pomodoro timer** — 25 / 5 / 15 min with session tracking and daily stats
- **Posture AI** — MediaPipe webcam tracking alerts you after 30s of bad posture
- **Auto show/hide** — app restores when posture is bad, minimizes when fixed
- **GIF break screens** — pick any `.gif` or `.webp` from your device
- **AI background removal** — strips GIF background so your character floats
- **Session stats** — 7-day bar chart, streaks, total hours, best day
- **Custom timer durations** — edit focus / break times in stats modal
- **Arcade aesthetic** — neon retro HUD, Press Start 2P font

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org) v18+
- npm

### Setup

```bash
git clone https://github.com/truetech-ai/focustimer.git
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
- `PomodoroPet Setup x.x.x.exe` — NSIS installer (Windows)
- `win-unpacked/` — portable, no install needed

> **Windows build note:** If you get a symlink error building Linux AppImage, enable **Developer Mode** in Windows Settings → System → For developers.

---

## Usage

| Action | Description |
|--------|-------------|
| Click timer ring | Start / pause |
| Reset button | Reset to current mode duration |
| POSTURE button | Open live skeleton view |
| STATS button | Session history, streaks, timer settings |
| Add GIF | Pick any `.gif` or `.webp` for break screen |
| AI mode | Removes GIF background (downloads ~35 MB model on first use) |
| Color-key mode | Fast background removal by color sampling |

---

## Project Structure

```
focustimer/
├── electron/
│   ├── main/
│   │   ├── main.cjs          # Electron main process
│   │   └── preload.cjs       # IPC bridge
│   ├── src/
│   │   ├── App.tsx           # Timer UI + logic
│   │   ├── components/       # BreakCanvas, GifPicker, PostureCanvas, StatsModal
│   │   └── hooks/            # useGifFrames, usePostureDetection
│   └── build/                # App icons
├── landing/
│   └── index.html            # Scrollytelling landing page
└── .github/workflows/
    └── build.yml             # CI: auto-builds on tag push
```

---

## Tech Stack

- [Electron](https://www.electronjs.org) — desktop shell
- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org) — UI
- [Vite](https://vitejs.dev) — bundler
- [MediaPipe Tasks Vision](https://developers.google.com/mediapipe) — posture AI
- [gifuct-js](https://github.com/matt-way/gifuct-js) — GIF parsing
- [@imgly/background-removal-node](https://github.com/imgly/background-removal-node) — AI background removal
