import { describe, it, expect } from 'vitest'
import { loadAutoUpdater } from '../../src/main/updater'

/**
 * Getting hold of the updater.
 *
 * `electron-updater` exports `autoUpdater` as a getter on a CommonJS
 * `module.exports`, and the lexer Node uses to work out a CJS module's named
 * exports cannot see getters. So a dynamic import hands back an object whose
 * only key is `default` — confirmed against the real package under Electron,
 * whose namespace carries `AppUpdater`, `NsisUpdater`, `RpmUpdater` and a
 * dozen more, and no `autoUpdater`.
 *
 * Reaching straight for `.autoUpdater` therefore got `undefined`, and nothing
 * noticed until the window grew a button: "Restart and update" threw `Cannot
 * read properties of undefined (reading 'quitAndInstall')` into the handler
 * and the app sat there.
 */
const anUpdater = { quitAndInstall: () => {} }

describe('finding the updater in whatever shape it arrives', () => {
  it('takes it off `default`, which is the shape the real package has', async () => {
    const found = await loadAutoUpdater(async () => ({ default: { autoUpdater: anUpdater } }))
    expect(found).toBe(anUpdater)
  })

  it('and off the namespace, where a bundler puts it there instead', async () => {
    const found = await loadAutoUpdater(async () => ({ autoUpdater: anUpdater }))
    expect(found).toBe(anUpdater)
  })

  it('prefers the namespace when a module somehow has both', async () => {
    const other = { quitAndInstall: () => {} }
    const found = await loadAutoUpdater(async () => ({
      autoUpdater: anUpdater,
      default: { autoUpdater: other }
    }))
    expect(found).toBe(anUpdater)
  })

  it('says so rather than handing back nothing', async () => {
    // Which is the whole of what went wrong: `undefined` travelled one call
    // further and failed somewhere that said nothing useful about why.
    await expect(loadAutoUpdater(async () => ({}))).rejects.toThrow('did not provide')
    await expect(loadAutoUpdater(async () => ({ default: {} }))).rejects.toThrow('did not provide')
  })
})
