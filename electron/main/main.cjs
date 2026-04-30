const { app, BrowserWindow, ipcMain, Notification, dialog, powerMonitor } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const DEV = !app.isPackaged

app.setAppUserModelId('com.pomodoropet.app')

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 720,
    minWidth: 700,
    minHeight: 600,
    frame: false,
    backgroundColor: '#000011',
    show: false,
    icon: path.join(__dirname, '../build/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,   // allow file:// img/video src from localhost dev server
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (DEV) {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow()
  })

  powerMonitor.on('lock-screen',   () => mainWindow?.webContents.send('system-lock'))
  powerMonitor.on('unlock-screen', () => mainWindow?.webContents.send('system-unlock'))
  powerMonitor.on('suspend',       () => mainWindow?.webContents.send('system-suspend'))
  powerMonitor.on('resume',        () => mainWindow?.webContents.send('system-resume'))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Window controls
ipcMain.on('win-minimize', () => mainWindow?.minimize())
ipcMain.on('win-maximize', () => {
  if (mainWindow) mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.on('win-close', () => mainWindow?.close())

// Always-on-top for break mode — blocks other apps
ipcMain.on('set-always-on-top', (_, flag) => {
  if (!mainWindow) return
  if (flag) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.focus()
  } else {
    mainWindow.setAlwaysOnTop(false)
  }
})

// Fullscreen for break/preview overlay — fills entire screen
ipcMain.on('set-fullscreen', (_, flag) => {
  mainWindow?.setFullScreen(flag)
})

// Notifications
ipcMain.on('notify', (_, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body }).show()
})

// Restore minimized window when timer fires
ipcMain.on('show-window', () => {
  mainWindow?.show()
  mainWindow?.focus()
})

// Native file picker for local GIFs
ipcMain.handle('pick-gif-files', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select GIF Files for Break Screen',
    filters: [{ name: 'Animated Images', extensions: ['gif', 'webp'] }],
    properties: ['openFile', 'multiSelections'],
  })
  return canceled ? [] : filePaths
})

// Read local file as bytes (renderer fetch() can't access file:// on Chromium)
ipcMain.handle('read-file', (_, filePath) => {
  return fs.readFileSync(filePath) // Buffer → serialized as Uint8Array in renderer
})

// AI background removal — @imgly/background-removal-node is ESM, dynamic import required
let _removeBg = null
async function getRemoveBg() {
  if (!_removeBg) {
    const mod = await import('@imgly/background-removal-node')
    _removeBg = mod.removeBackground
  }
  return _removeBg
}

// Receives PNG as Uint8Array from renderer (frame 0 composited to full GIF size)
// Returns PNG with transparent background as Buffer
ipcMain.handle('remove-bg-frame', async (_, pngData) => {
  const removeBg = await getRemoveBg()
  const blob = new Blob([new Uint8Array(pngData)], { type: 'image/png' })
  const result = await removeBg(blob, { debug: false, model: 'small' })
  return Buffer.from(await result.arrayBuffer())
})

// ── AI mask disk cache ────────────────────────────────────────────────────────
function getBgCacheDir() {
  const dir = path.join(app.getPath('userData'), 'bg-cache')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function maskCachePath(mediaPath) {
  const key = crypto.createHash('sha1').update(mediaPath).digest('hex')
  return path.join(getBgCacheDir(), key + '.png')
}

ipcMain.handle('cache-read', (_, mediaPath) => {
  const p = maskCachePath(mediaPath)
  return fs.existsSync(p) ? fs.readFileSync(p) : null
})

ipcMain.handle('cache-write', (_, mediaPath, pngData) => {
  fs.writeFileSync(maskCachePath(mediaPath), Buffer.from(new Uint8Array(pngData)))
})

ipcMain.handle('cache-count', () => {
  try {
    return fs.readdirSync(getBgCacheDir()).filter(f => f.endsWith('.png')).length
  } catch { return 0 }
})

ipcMain.handle('cache-clear', () => {
  const dir = getBgCacheDir()
  try { fs.readdirSync(dir).forEach(f => fs.unlinkSync(path.join(dir, f))) } catch {}
})

// List local GIFs (fallback)
ipcMain.handle('list-gifs', () => {
  const dir = DEV
    ? path.join(__dirname, '../public/gifs')
    : path.join(process.resourcesPath, 'public/gifs')
  try {
    return fs
      .readdirSync(dir)
      .filter(f => /\.(gif|webp)$/i.test(f))
      .map(f => `./gifs/${f}`)
  } catch {
    return []
  }
})
