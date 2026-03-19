import { app, BrowserWindow, shell } from 'electron'
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
    titleBarStyle: 'hiddenInset',
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
  await initDatabase()

  // Register IPC handlers
  registerIPCHandlers()

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
