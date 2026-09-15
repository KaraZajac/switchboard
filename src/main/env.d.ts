/**
 * The version, put in by the bundler.
 *
 * Read from `package.json` at build time rather than from `app.getVersion()`,
 * which answers with Electron's own version when the app is not packaged — so
 * a build run from source told everyone who CTCP'd it that it was Switchboard
 * 44.3.0.
 */
declare const __APP_VERSION__: string
