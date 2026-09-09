import { app, BrowserWindow, Menu, Tray, session, shell, nativeImage } from 'electron'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import { registerIPCHandlers } from './ipc/index'
import { ircManager } from './irc/manager'
import { initDatabase, closeDatabase } from './storage/database'
import { loadSTSPolicies, persistSTSPoliciesWith } from './irc/features/sts'
import { allSTSPolicies, saveSTSPolicy, forgetSTSPolicy } from './storage/models/sts'
import { stopRemoteLink } from './remote/link'
import { encryptStoredCredentials } from './storage/models/server'
import { secretsBackendDescription } from './storage/secrets'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow(): void {
  const appIcon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    icon: appIcon,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#111214',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    // SWITCHBOARD_NO_DEVTOOLS keeps the window clean when running an unpackaged
    // build to look at the UI itself.
    if (!app.isPackaged && !process.env['SWITCHBOARD_NO_DEVTOOLS']) {
      mainWindow?.webContents.openDevTools()
    }
  })

  // Minimize to tray on close (don't quit)
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Keep the window controls in sync when the window is resized by the WM
  mainWindow.on('maximize', () => sendToRenderer('window:maximized', { maximized: true }))
  mainWindow.on('unmaximize', () => sendToRenderer('window:maximized', { maximized: false }))

  // Set up IRC manager with main window for IPC
  ircManager.setMainWindow(mainWindow)

  // Load the renderer
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createAppMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    }] : []),
    // File
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Server',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:add-server')
        },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:settings')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // Edit
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    // View
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    // Window
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const }
        ] : [
          { role: 'close' as const }
        ])
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createTray(): void {
  // macOS wants a template image (a black glyph plus alpha, which the menu bar
  // recolours). Everywhere else the full icon reads better, since a tray theme
  // can be light or dark.
  const isMac = process.platform === 'darwin'
  const trayIconPath = join(
    __dirname,
    isMac ? '../../resources/tray-icon-mac.png' : '../../resources/tray-icon.png'
  )
  const trayIcon = nativeImage.createFromPath(trayIconPath)
  if (isMac) {
    trayIcon.setTemplateImage(true)
  }

  tray = new Tray(trayIcon)
  tray.setToolTip('Switchboard')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Switchboard',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus()
    } else {
      mainWindow?.show()
    }
  })
}

// ── Auto-update ──────────────────────────────────────────────────────

function setupAutoUpdater(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    sendToRenderer('updater:checking', {})
  })

  autoUpdater.on('update-available', (info) => {
    sendToRenderer('updater:available', { version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    sendToRenderer('updater:not-available', {})
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('updater:progress', { percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendToRenderer('updater:ready', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message)
  })

  // Rejects when a release has no updater metadata (or the network is down).
  // The 'error' handler above already reports it — this just keeps it from
  // surfacing as an unhandled rejection.
  autoUpdater.checkForUpdatesAndNotify().catch(() => {})
}

function sendToRenderer(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

// Track whether we're quitting vs just closing the window
let isQuitting = false

app.whenReady().then(async () => {
  // Initialize database
  try {
    await initDatabase()

    // Strict Transport Security has to outlive the session to mean anything:
    // a client that forgets on restart offers a plaintext window on every
    // launch, which is exactly what the policy exists to close.
    persistSTSPoliciesWith({ save: saveSTSPolicy, forget: forgetSTSPolicy })
    loadSTSPolicies(allSTSPolicies())

    // Credentials used to be written to disk in the clear; encrypt anything
    // left over from an older build before anything else reads them.
    const { migrated, protected: credentialsProtected } = encryptStoredCredentials()
    if (migrated > 0) {
      console.info(`Encrypted stored credentials for ${migrated} server(s)`)
    }
    if (!credentialsProtected) {
      console.warn(`Credential storage: ${secretsBackendDescription()}`)
    }
  } catch (err) {
    console.error('Failed to initialize database:', err)
  }

  // Register IPC handlers
  registerIPCHandlers()

  // Set CSP for production
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' https:; frame-src https://www.youtube.com; connect-src 'self' https://api.klipy.com https://static.klipy.com;"
          ]
        }
      })
    })
  }

  // Create app menu
  createAppMenu()

  // Create window
  createWindow()

  // Create tray icon
  createTray()

  // Set up auto-updater
  setupAutoUpdater()

  // Auto-connect servers once the renderer is listening (it calls
  // 'app:renderer-ready'). This timer is the fallback for a renderer that never
  // reports in, so a broken window still leaves the connections up.
  setTimeout(() => ircManager.autoConnectAll(), 5_000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

let shuttingDown = false

app.on('before-quit', (event) => {
  if (shuttingDown) return
  event.preventDefault()
  shuttingDown = true
  isQuitting = true

  // Closing on purpose should hand over immediately. Without telling the phone,
  // it waits out the heartbeat timeout first — sixteen seconds during which the
  // user is connected to nothing and does not know it.
  void shutdown().finally(() => app.exit(0))
})

/**
 * Leave tidily, but never hang on it.
 *
 * A network call that does not come back must not stop the app from closing,
 * so everything here races a short timer.
 */
async function shutdown(): Promise<void> {
  const withTimeout = (work: Promise<unknown>, ms: number) =>
    Promise.race([work, new Promise((resolve) => setTimeout(resolve, ms))])

  await withTimeout(stopRemoteLink().catch(() => {}), 1500)

  ircManager.destroyAll()
  // Checkpoints the write-ahead log and takes it away with it, so the next
  // launch opens one file rather than recovering from two.
  closeDatabase()
}
