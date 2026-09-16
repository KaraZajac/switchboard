import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  session,
  shell,
  nativeImage,
  clipboard,
  ipcMain,
  type IpcMainInvokeEvent
} from 'electron'
import { setHost } from './host'
import { electronHost } from './host/electron'

/*
 * What this process is running on, before anything else.
 *
 * The engine below `src/main` — connections, storage, vault, session, link —
 * asks the host for the few things it needs from a machine: somewhere to put
 * files, a keychain, whether anybody is idle, and a fetch that honours the
 * proxy. Nothing down there imports Electron any more, which is what lets the
 * same engine run with no window on something that never sleeps.
 *
 * Installed at the top of the module rather than in `whenReady`, because
 * storage is touched on the way there.
 */
setHost(electronHost)
import { setAppVersion } from './irc/handlers/message'
import { useNetworkSettings } from './irc/connection'
import type { ProxySettings } from '@shared/socks'
import { safeExternalUrl } from '@shared/links'
import { imageMenuTemplate } from './menus/image'
import { setNotifier } from './ipc/notify'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import { registerIPCHandlers } from './ipc/index'
import { useLocalBridge } from './ipc/registry'
import { ircManager } from './irc/manager'
import { parseIrcUrl } from '@shared/ircurl'
import { restoreVault } from './vault/vault'
import { initDatabase, closeDatabase } from './storage/database'
import { loadSTSPolicies, persistSTSPoliciesWith } from './irc/features/sts'
import { allSTSPolicies, saveSTSPolicy, forgetSTSPolicy } from './storage/models/sts'
import { resumeRemoteLink, stopRemoteLink } from './remote/link'
import { encryptStoredCredentials, getAllServers, updateServer } from './storage/models/server'
import { getSetting } from './storage/models/settings'
import { hasOverride, sameProfile, overrideFrom } from '@shared/profile'
import { secretsBackendDescription } from './storage/secrets'
import { watchIdleTime } from './irc/features/autoaway'
import { onTransferChange } from './irc/features/dcc'

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

  // Keep the window controls in sync when the window is resized by the WM
  mainWindow.on('maximize', () => sendToRenderer('window:maximized', { maximized: true }))
  mainWindow.on('unmaximize', () => sendToRenderer('window:maximized', { maximized: false }))

  // The window is a subscriber like any other, which is what lets the engine
  // run without one at all
  const window = mainWindow
  const stopForwarding = ircManager.subscribe((channel, data) => {
    if (!window.isDestroyed()) window.webContents.send(channel, data)
  })
  window.on('closed', stopForwarding)

  // Load the renderer
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Answer a right-click.
 *
 * The template — and the decision whether there is one at all — lives in
 * `menus/image`, where it can be tested; this is the part that needs a window
 * and a clipboard. Saving and copying go through the page's own `webContents`,
 * which already has the bytes it drew, so nothing here reaches the network
 * again. The address is handed to `safeExternalUrl` before the operating
 * system is allowed near it, for the reasons written above
 * `web-contents-created`: an address in a message is a stranger's text.
 */
function showContextMenu(
  contents: Electron.WebContents,
  params: Electron.ContextMenuParams
): void {
  const template = imageMenuTemplate(params, {
    save: () => contents.downloadURL(params.srcURL),
    copy: () => contents.copyImageAt(params.x, params.y),
    copyLink: () => clipboard.writeText(params.srcURL),
    open: () => {
      const safe = safeExternalUrl(params.srcURL)
      if (safe) void shell.openExternal(safe)
    }
  })

  if (template) Menu.buildFromTemplate(template).popup()
}

function createAppMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
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
          }
        ]
      : []),
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
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }])
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

// Anything that changes the stored servers without going through the window —
// a paired phone, an adopted vault — tells it so through here.
setNotifier(sendToRenderer)

// Track whether we're quitting vs just closing the window
let isQuitting = false

/**
 * An `irc://` link, from the command line or the operating system.
 *
 * A network we already have is joined — connected first, if it has to be —
 * and the window is pointed at the channel. One we do not have opens the
 * add-network form with the address filled in, because a nick is the
 * user's to choose. See `@shared/ircurl`.
 */
function openIrcLink(raw: string): void {
  const link = parseIrcUrl(raw)
  if (!link) return
  mainWindow?.show()
  mainWindow?.focus()

  // Host *and* port. Matching on the host alone put an `irc://host:6667` link
  // onto whichever network happened to be listed first at that address, which
  // for anyone running more than one server on a box is the wrong one. A link
  // that names no port matches any network at that address, since the default
  // is a guess rather than something the user typed.
  const sameHost = getAllServers().filter(
    (server) => server.host.toLowerCase() === link.host.toLowerCase()
  )
  const known = sameHost.find((server) => server.port === link.port) ?? sameHost[0]
  if (!known) {
    sendToRenderer('link:add-server', {
      host: link.host,
      port: link.port,
      tls: link.tls,
      channel: link.channel
    })
    return
  }

  const target = link.channel ?? link.nick
  const client = ircManager.getClient(known.id)
  if (client && client.state.registrationState === 'connected') {
    if (link.channel) client.join(link.channel)
  } else {
    // Joined on arrival, along with whatever the network always joins
    const autoJoin =
      link.channel && !known.autoJoin.includes(link.channel)
        ? [...known.autoJoin, link.channel]
        : known.autoJoin
    ircManager.connect({ ...known, autoJoin })
  }
  if (target) sendToRenderer('link:open', { serverId: known.id, channel: target })
}

/** The first irc:// link among the arguments a launch or a second launch brought */
function ircLinkIn(argv: string[]): string | undefined {
  return argv.find((arg) => /^ircs?:\/\//i.test(arg))
}

// One window per profile. A second launch — the way a browser hands over an
// irc:// link on Linux and Windows — is passed to the one already running.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
    const link = ircLinkIn(argv)
    if (link) openIrcLink(link)
  })
  // macOS hands the link over this way instead
  app.on('open-url', (event, url) => {
    event.preventDefault()
    if (app.isReady()) openIrcLink(url)
    else app.whenReady().then(() => setTimeout(() => openIrcLink(url), 1_500))
  })
}

/**
 * Anything that goes wrong on the way up, said out loud.
 *
 * `whenReady().then(...)` with nothing after it swallows a throw: the window
 * is created at the end of that function, so a failure anywhere before it
 * means no window, `window-all-closed`, and a clean exit zero. The app simply
 * does not appear, and there is nothing anywhere to say why.
 */
app
  .whenReady()
  .then(async () => {
    // What a CTCP VERSION gets told, before anything can be asked. The
    // build-time version rather than `app.getVersion()`, which answers with
    // Electron's own when the app is not packaged.
    setAppVersion(__APP_VERSION__, process.platform)

    // Where connections dial through, and what they will trust. Read on each
    // dial rather than captured, so a proxy typed into settings applies to the
    // next connection rather than the next launch. Machine-local on purpose:
    // both of these describe where this computer is, not who you are, so
    // neither travels to a paired phone.
    // Go away when the keyboard goes quiet, if that was asked for
    watchIdleTime(ircManager)

    // A transfer starting, moving or finishing. One event rather than a poll:
    // a progress bar that only moves when something else happens is worse than
    // no progress bar.
    onTransferChange((transfer) => sendToRenderer('dcc:transfer', transfer))

    useNetworkSettings(() => ({
      proxy: getSetting<ProxySettings>('proxy') ?? null,
      caPath: getSetting<string>('customCaPath') ?? null
    }))

    // Initialize database
    try {
      await initDatabase()

      // Strict Transport Security has to outlive the session to mean anything:
      // a client that forgets on restart offers a plaintext window on every
      // launch, which is exactly what the policy exists to close.
      persistSTSPoliciesWith({ save: saveSTSPolicy, forget: forgetSTSPolicy })
      loadSTSPolicies(allSTSPolicies())

      // Open the shared config with the key the keychain kept, if the user asked
      // for that. Without it every restart left the vault locked — and a locked
      // vault silently stops servers, settings and channels reaching the phone.
      restoreVault()

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

    // What a network was given rather than what it was handed a copy of.
    //
    // Adding a network used to copy the default profile into it, so every
    // network has one of its own without anybody choosing that — and under the
    // rule that a network with its own profile ignores the global, editing your
    // name would have changed nothing anywhere.
    //
    // Narrowed field by field rather than all or nothing: somebody who changed
    // their display name on one network got a whole frozen copy along with it,
    // and only the name was ever a choice. What matches the global goes back to
    // following it; what differs stays.
    try {
      const global = getSetting<Record<string, string>>('profile') ?? {}
      let freed = 0
      for (const server of getAllServers()) {
        if (!hasOverride(server.profile)) continue
        const narrowed = overrideFrom(global, server.profile) ?? {}
        if (sameProfile(narrowed, server.profile)) continue
        updateServer(server.id, { profile: narrowed })
        freed++
      }
      if (freed > 0) console.info(`${freed} network(s) now follow your profile again`)
    } catch (err) {
      console.error('Could not tidy seeded profiles:', err)
    }

    // Register IPC handlers. The window listens over Electron IPC; the registry
    // keeps the same handlers for a paired device, and for a headless instance
    // that has no window to listen for.
    useLocalBridge((channel, handler) =>
      ipcMain.handle(channel, handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)
    )
    registerIPCHandlers()

    // A paired phone should be able to reach this desktop the moment it is
    // running, not only after somebody visits Settings.
    void resumeRemoteLink()

    /*
     * Where a saved picture goes is the person's decision.
     *
     * Electron puts a download wherever it likes unless somebody says
     * otherwise, and "it downloaded, somewhere" is not an answer. Asking is
     * what every browser does with Save image as…, and the name the server
     * gave is the right thing to offer.
     */
    session.defaultSession.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({ defaultPath: item.getFilename() })
      console.info('Saving %s', item.getFilename())
    })

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

    /*
     * One set of rules for every window there will ever be.
     *
     * Three things, all on the same reasoning: the preload hands
     * `window.switchboard` to whatever is loaded, so anything that is not
     * Switchboard must never be loaded *here*.
     *
     *  - A link opens outside, and only if we are willing to open it.
     *    `shell.openExternal` hands a URL to the operating system, which
     *    attempts whatever scheme it is given — `file:///` reads this machine,
     *    and on Windows a handler scheme can start a program. The URL is not
     *    always one the user typed: a profile's `homepage` is a metadata key, so
     *    a stranger sets it and anybody can click it.
     *  - Nothing navigates a window away from the app.
     *  - Nothing attaches a webview, which would come with a preload of its own.
     *
     * On `web-contents-created` rather than on the window, because a guard that
     * only covers the windows written so far is a guard that stops covering.
     */
    app.on('web-contents-created', (_event, contents) => {
      contents.setWindowOpenHandler((details) => {
        const safe = safeExternalUrl(details.url)
        if (safe) void shell.openExternal(safe)
        return { action: 'deny' }
      })

      contents.on('will-navigate', (event, url) => {
        // A reload of what is already showing is not navigation
        if (url === contents.getURL()) return
        event.preventDefault()
        const safe = safeExternalUrl(url)
        if (safe) void shell.openExternal(safe)
      })

      contents.on('will-attach-webview', (event) => event.preventDefault())

      // And a right-click gets a menu, which an Electron app has to build
      contents.on('context-menu', (_event, params) => showContextMenu(contents, params))
    })

    // Create app menu
    createAppMenu()

    // Create window
    createWindow()

    // Create tray icon
    createTray()

    // Links on web pages: `irc://` and `ircs://` open here, the way they open
    // in every other desktop client
    for (const scheme of ['irc', 'ircs']) {
      try {
        app.setAsDefaultProtocolClient(scheme)
      } catch {
        // A platform that will not let us — nothing to do about it
      }
    }
    const launchLink = ircLinkIn(process.argv)
    if (launchLink) setTimeout(() => openIrcLink(launchLink), 3_000)

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
  .catch((err) => {
    console.error('Switchboard could not finish starting:', err)
    // A broken feature must not mean no window at all
    if (!mainWindow) createWindow()
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

  await withTimeout(
    stopRemoteLink().catch(() => {}),
    1500
  )

  ircManager.destroyAll()
  // Checkpoints the write-ahead log and takes it away with it, so the next
  // launch opens one file rather than recovering from two.
  closeDatabase()
}
