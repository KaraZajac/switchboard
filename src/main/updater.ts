/**
 * Getting hold of the updater.
 *
 * One function, in its own file, because the way it has to be written is not
 * obvious and it was wrong in a way nothing noticed.
 *
 * Loaded on demand rather than imported: `electron-updater` reaches for
 * `electron` as it loads, and the module that asks for this also registers the
 * handlers for the headless build, which has no Electron at all.
 *
 * And `.autoUpdater` is not on the namespace. It is a *getter* on a CommonJS
 * `module.exports`, and the lexer Node uses to work out a CJS module's named
 * exports cannot see getters — so a dynamic import hands back an object whose
 * only key is `default`, and reaching straight for `.autoUpdater` gets
 * `undefined`. Confirmed against the real package under Electron: the
 * namespace carries `AppUpdater`, `NsisUpdater`, `RpmUpdater` and a dozen
 * more, and no `autoUpdater`.
 *
 * A static `import { autoUpdater }` is fine, because a bundler turns that into
 * a plain `require` — which is why the one in `src/main/index.ts` has always
 * worked and this one never did. It was never called until the window grew a
 * button for it, and then "Restart and update" threw `Cannot read properties
 * of undefined (reading 'quitAndInstall')` into the handler and the app sat
 * there doing nothing.
 */

type AutoUpdater = typeof import('electron-updater').autoUpdater

/** Both shapes, since which one a bundler produces is its business */
interface Loaded {
  autoUpdater?: AutoUpdater
  default?: { autoUpdater?: AutoUpdater }
}

export async function loadAutoUpdater(
  load: () => Promise<unknown> = () => import('electron-updater')
): Promise<AutoUpdater> {
  const loaded = (await load()) as Loaded
  const found = loaded.autoUpdater ?? loaded.default?.autoUpdater
  // Rather than handing back `undefined` for somebody else to trip over, which
  // is the whole of what went wrong here
  if (!found) throw new Error('electron-updater did not provide an autoUpdater')
  return found
}
