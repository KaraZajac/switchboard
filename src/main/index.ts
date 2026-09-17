import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  screen,
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
import { bringOnScreen, type Rect } from './window/onscreen'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

/**
 * Put the window in front of whoever asked for it.
 *
 * Every way back to the window goes through here — the tray, the dock, a
 * second launch, an `irc://` link — because `show()` and `focus()` on their
 * own are not a way back. Three things had to be true and were not:
 *
 *  - **There has to be a window.** On Linux and Windows closing one destroys
 *    it, and `mainWindow` was left pointing at the wreckage rather than at
 *    null, so the tray's own "Show Switchboard" called `show()` on a destroyed
 *    object. That throws inside a menu handler, which swallows it: the icon is
 *    there, clicking it does nothing, and nothing says why.
 *  - **It has to be somewhere that exists.** A window remembers where it was;
 *    a monitor does not have to still be there. See `./window/onscreen` — this
 *    is the state where the app is running, the tray icon is in the panel, and
 *    there is no window anywhere.
 *  - **It has to be un-minimised first.** `show()` on a minimised window
 *    leaves it minimised.
 */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }

  const home = whereItShouldBe(mainWindow)
  if (home) mainWindow.setBounds(home)

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Where a window ought to be moved to, or null if it is already fine.
 *
 * Work areas rather than whole displays: a window centred behind a panel is
 * only half a rescue. The primary display goes first, because it is the screen
 * somebody is looking at when they wonder where the window went.
 */
function whereItShouldBe(window: BrowserWindow): Rect | null {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  const ordered = [primary, ...displays.filter((d) => d.id !== primary.id)]
  return bringOnScreen(
    window.getBounds(),
    ordered.map((d) => d.workArea)
  )
}

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

  /**
   * Show it, whatever happened to the first paint.
   *
   * `ready-to-show` is the window's only cue to appear, and it is not a
   * promise: it fires when the renderer has painted, so a renderer that
   * crashes on the way up, or a load that fails, simply never fires it. The
   * app then runs with a tray icon and no window and no way to get one, which
   * is indistinguishable from the app being broken in some other way.
   *
   * A blank window is a much better failure than no window: it can be closed,
   * moved, reloaded, and complained about.
   */
  const reveal = (): void => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return
    mainWindow.show()
  }
  const revealAnyway = setTimeout(reveal, 10_000)

  mainWindow.on('ready-to-show', () => {
    clearTimeout(revealAnyway)
    reveal()
    // SWITCHBOARD_NO_DEVTOOLS keeps the window clean when running an unpackaged
    // build to look at the UI itself.
    if (!app.isPackaged && !process.env['SWITCHBOARD_NO_DEVTOOLS']) {
      mainWindow?.webContents.openDevTools()
    }
  })

  // Said out loud rather than left to the blank window above. All three are
  // the renderer failing to come up, and none of them reach a console anybody
  // is looking at otherwise.
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`The window could not load ${url}: ${description} (${code})`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`The window's renderer went away: ${details.reason}`)
  })
  mainWindow.webContents.on('unresponsive', () => {
    console.warn('The window has stopped responding')
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
  window.on('closed', () => {
    stopForwarding()
    clearTimeout(revealAnyway)
    // Let go of it. A destroyed window is not a window, and every `show()`
    // through this variable throws once it is one — see [showMainWindow].
    if (mainWindow === window) mainWindow = null
  })

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
function showContextMenu(contents: Electron.WebContents, params: Electron.ContextMenuParams): void {
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
      click: showMainWindow
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

  // Always the full journey, never `focus()` alone. A window that reports
  // itself visible can still be on a monitor that is no longer plugged in,
  // and focusing it there focuses something nobody can see.
  tray.on('click', showMainWindow)
}

// ── Auto-update ──────────────────────────────────────────────────────

/**
 * Whether installing an update here means asking for a root password.
 *
 * Everywhere else an update installs as the user: Windows runs the installer,
 * macOS swaps the bundle, and an AppImage replaces its own file. A Linux
 * package does not — it belongs to the system package manager, so the install
 * is `dnf` or `apt` and that is `pkexec`.
 *
 * Which is fine when somebody asked for it, and alarming when nobody did. See
 * [setupAutoUpdater].
 */
const installNeedsRoot = process.platform === 'linux' && !process.env['APPIMAGE']

function setupAutoUpdater(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true

  /**
   * Installing on quit, except where quitting would ask for a password.
   *
   * On a Linux package install this fired on the way out and ran
   *
   *     pkexec --disable-internal-agent /bin/bash -c 'dnf install --nogpgcheck -y …'
   *
   * so closing an IRC client put up a system dialog saying an application
   * wanted to run a root shell — `/bin/bash`, in those words — attached to
   * nothing the user had done and with no explanation from us. Worse, the spawn is synchronous
   * and runs inside the quit handler: the app hangs, unresponsive and still on
   * screen, for as long as the dialog is up — forty-seven seconds, the last
   * time it happened here — and if the dialog is dismissed the install fails
   * silently and the app has to be closed again to retry it.
   *
   * So on those builds the update waits to be asked for. The window offers it
   * once it is downloaded, and the password prompt then arrives one click
   * after a button that said it would.
   */
  autoUpdater.autoInstallOnAppQuit = !installNeedsRoot

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
    sendToRenderer('updater:ready', { version: info.version, needsRoot: installNeedsRoot })
  })

  /**
   * Said where somebody can see it.
   *
   * This was a `console.error` and nothing else, which on a packaged build
   * means the journal — so an update that could not install looked exactly
   * like an update that had not happened yet, every time, with the app quite
   * sure it was up to date.
   */
  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message)
    sendToRenderer('updater:error', { message: err.message })
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
  showMainWindow()

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

/**
 * One window per profile. A second launch — the way a browser hands over an
 * irc:// link on Linux and Windows — is passed to the one already running.
 *
 * `app.quit()` was the whole of it, and a quit is a request rather than an
 * exit: `before-quit` below stops it to shut down tidily, and `whenReady`
 * resolves long before that finishes. So the launch that lost the lock went on
 * to run the entire startup anyway — a second connection to a database another
 * process has open, a second unlock of the vault, a second window, and a
 * second tray icon — and only then died, taking that icon down by way of
 * `app.exit`, which is not how a tray icon is meant to be given back.
 *
 * Found by launching it twice: the loser logged "Checking for update", which
 * only happens four statements after the window and the tray are built.
 */
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    showMainWindow()
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
    // The launch that lost the lock has already handed its arguments over and
    // is on its way out. Nothing below is its business.
    if (!primaryInstance) return

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

    /**
     * A monitor going away must not take the window with it.
     *
     * The window is on X11 — Electron's default on Linux, XWayland under a
     * Wayland session — where its coordinates are real and stay where they
     * were put. Unplug the screen they were on and the window is still open,
     * still "visible", and nowhere.
     *
     * Settled first, because a display set that is being rebuilt reports its
     * screens one at a time: a session coming back from sleep, or a
     * compositor that has just told every app there are no outputs at all,
     * passes through several arrangements on the way to the real one. Moving
     * the window for each of them would fight whoever is plugging things in.
     */
    let settling: NodeJS.Timeout | undefined
    const rescueWindow = (): void => {
      clearTimeout(settling)
      settling = setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return
        const home = whereItShouldBe(mainWindow)
        if (!home) return
        console.info('The window was on a screen that is no longer there; bringing it back')
        mainWindow.setBounds(home)
      }, 1_500)
    }
    screen.on('display-removed', rescueWindow)
    screen.on('display-added', rescueWindow)
    screen.on('display-metrics-changed', rescueWindow)

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

    app.on('activate', showMainWindow)
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
  // Nothing was started, so there is nothing to put away, and delaying this
  // quit only keeps a duplicate launch alive for longer than it should be.
  if (!primaryInstance) return
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
