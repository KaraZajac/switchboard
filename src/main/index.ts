import { app, BrowserWindow, session, shell } from 'electron'
import { join } from 'path'
import { registerIPCHandlers } from './ipc/index'
import { ircManager } from './irc/manager'
import { initDatabase, closeDatabase, saveDatabase } from './storage/database'
import { getAllServers } from './storage/models/server'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
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
    if (!app.isPackaged) {
      mainWindow?.webContents.openDevTools()
    }
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Set up IRC manager with main window for IPC
  ircManager.setMainWindow(mainWindow)

  // Load the renderer
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Initialize database
  try {
    await initDatabase()
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
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:;"
          ]
        }
      })
    })
  }

  // Create window
  createWindow()

  // Auto-connect servers
  const servers = getAllServers()
  for (const server of servers) {
    if (server.autoConnect) {
      ircManager.connect(server)
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // Save pending messages and disconnect
  saveDatabase()
  ircManager.destroyAll()
  closeDatabase()
})
