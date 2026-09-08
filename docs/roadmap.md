# Switchboard roadmap: Android companion + encryption at rest

Research notes and a proposed plan for two tracks:

- **Track A** — an Android client that pairs with the desktop app and proxies through it, so
  there is one IRC login and one shared state, with no ports to open or firewalls to configure.
- **Track B** — encrypting everything Switchboard keeps on disk.

Written September 2026. Links to sources are at the bottom.

---

## Status — what is built (8 September 2026)

Track A phases 1–4 and Track B phase 1 are working end to end, desktop and
Android, against a live IRC network — including failover: the phone takes over
the connection when the desktop goes away, and gives it back when it returns.

| | |
|---|---|
| **B1 · credentials encrypted** | done — `safeStorage`, migration on launch, backend reported in Settings → Network |
| **A1 · transport spike** | done — iroh 1.1.0, direct QUIC hole punch, 0.6 s to first byte |
| **A2 · remote core** | done — one handler registry serves the window and paired devices, with an allowlist |
| **A3 · Android client** | done — mirrors the desktop: channels, history, live events, unread, profiles |
| **A4 · sending** | done — the phone composes through the desktop's connection |
| **A5 · standalone Android client** | done — a Kotlin IRC engine on the phone, sharing one protocol corpus with the desktop |
| **A6 · failover** | done — session coordinator on both sides; one device holds the connection at a time |
| **B3 · shared vault** | done — one passphrase, PBKDF2 + AES-256-GCM, byte-compatible across TypeScript and Kotlin |
| **A7 · QR pairing** | done — the desktop's QR carries the ticket and the code, the phone reads it with the camera |
| **A8 · full IRCv3 on the phone** | done — the Kotlin engine handles what the desktop handles, checked against a live server |
| **A9 · unattended failover** | done — foreground service, vault kept open across restarts |
| **A10 · Doze** | done — goodbye on clean shutdown, exact-alarm backstop, wake on idle exit, battery-exemption prompt |
| **A11 · push wake-ups** | crypto done, wire blocked — see below |
| **B2 · whole-database encryption** | not started |
| **Profile metadata** | done — all six registry keys, published, subscribed and rendered on both clients |

### A11 · push wake-ups — where it stands

`draft/webpush` turned out to be a better answer than UnifiedPush alone. The
device hands the IRC server an endpoint and two keys; the server encrypts each
notification to those keys (RFC 8291) and gives it to a push service, which
forwards something it cannot read. UnifiedPush is still how an Android device
*gets* an endpoint without Google — the two are complements, not alternatives.

**Done.** The encryption, twice: `src/main/push/webpush.ts` and
`android/.../push/WebPush.kt`, sharing no code, each suite reading what the
other wrote. The `WEBPUSH REGISTER` / `UNREGISTER` commands, the VAPID key
parsed out of the capability value, and the server's answer surfaced instead of
dropped.

**Blocked on the server.** Tested against rIRCd, which:

1. advertises the capability as bare `draft/webpush`, with no `vapid=` value.
   The spec puts the server's VAPID public key there, and a device needs it as
   the application server key when it subscribes — without it most push
   services will refuse the subscription.
2. requires an account before `WEBPUSH REGISTER` (`FAIL WEBPUSH
   ACCOUNT_REQUIRED`), which is right, but account creation needs an email
   round trip that cannot be completed against the test instance.

**Next, once those are settled.** Pick a UnifiedPush distributor, wire the
receiver, register the endpoint on connect, and decrypt into the existing
notification path — which already exists and already groups by conversation.

Where it lives:

- `src/main/remote/` — the iroh endpoint, framing, pairing and dispatch
- `src/main/ipc/registry.ts` — the shared handler registry, `REMOTE_ALLOWED`, and
  the sanitiser that keeps IRC credentials off the wire
- `src/main/storage/secrets.ts` — credential encryption
- `src/main/vault/` — the shared vault: crypto, sealing, and adopting a peer's config
- `src/main/session/coordinator.ts` — which device is holding the connections
- `android/` — the Kotlin client (`computer.iroh:iroh-android:1.1.0`, Compose),
  with its own IRC engine, vault and session coordinator
- `tests/fixtures/` — the corpus both test suites read, so the two
  implementations cannot drift apart unnoticed

Measured on the first run: pairing to first message on screen in about a second,
over a direct connection, with the phone never seeing an IRC password.

What the mirror needed beyond the transport, found by building it:

- The core has to *hold* metadata (`ConnectionState.metadata`), not just forward it —
  otherwise a reloading window or a freshly paired phone shows raw nicks while the
  desktop shows display names.
- Servers push everyone's metadata when *you* join a channel, but not when someone
  else joins later, so the client asks per nick on their JOIN.
- Both ends must serialise writes on the QUIC stream. Two concurrent `writeAll`
  calls break the link, and because nothing awaits them it fails silently — events
  simply stop arriving.
- The phone needs a persistent secret key. Without one it turns up as a new
  device on every launch and has to be paired again.

### Failover and the shared vault

The phone is a full IRC client, not only a second window. While the desktop is
running it follows; when the desktop's heartbeat lapses it unseals the shared
config and connects to everything the desktop was holding; when the desktop
returns, it hands back. The user is only ever logged in once.

Two devices, one identity, so exactly one may be on the network at a time. That
is what the session coordinator is for — desktop priority 100, phone 10,
heartbeat every 5 s, three missed beats before a follower concludes the primary
is gone, and a discovery window on start so a returning device looks before it
leaps.

The vault is what makes it possible: the server list, nicks and SASL credentials
sealed under a passphrase the user types on each device. The passphrase never
travels; only the sealed envelope does. Both implementations derive the same key
from the same passphrase — verified in both directions by fixtures each side
seals for the other.

What building it turned up, none of which the plan anticipated:

- **A follower has to keep beating.** A silent follower is invisible to the
  primary, which then cannot tell "no peer" from "a peer that is following me".
- **A write on a dead QUIC stream throws**, and the session heartbeat is exactly
  what fires when the desktop has stopped answering. Unhandled, it took the
  whole phone app down at the one moment it was supposed to carry on alone.
- **The phone has to re-dial.** Without a reconnect loop it holds the connection
  forever and the returning desktop joins the network beside it.
- **Turning the remote link on must not reconnect what is already connected.**
  It did, which dropped the user and brought them back as `nick_`.
- **Nick recovery is not optional.** Even with the ordering right, a handover
  can leave the returning device on `nick_` for a few seconds. Asking for the
  real nick back every 20 s resolves it — and does the same for netsplits and
  ghosts, which is why every other client does it.
- **600,000 PBKDF2 iterations is a second of CPU.** On the main thread that is
  long enough for Android to put up "isn't responding". The cost is the point,
  so it has to be paid off-thread.
- **sql.js rewrites the whole database on every save.** A truncating write there
  means any crash takes the servers, credentials and history with it; the save is
  now write-to-temp, fsync, rename, keeping the previous copy to fall back on.

### Conformance

Both clients are tested against rIRCd (`~/Projects/rIRCd`), which advertises far
more capabilities than most servers and so exposes bugs that stay invisible
elsewhere. Reading the wire found eight defects that no unit test would have:

- **No send throttle.** Every ircd has a send-queue limit; ignoring it means
  commands are silently dropped, or the connection is killed for excess flood.
- **A CAP REQ over 512 bytes**, answered with `417` — the client never connected
  at all, and only once the capability list grew enough to cross the line.
- **Batched messages dispatched as live traffic.** With event-playback, a
  replayed JOIN re-ran the whole channel sync, whose reply replayed it again.
- **Capability names no server advertises** (`draft/no-implicit-names`,
  `UTF8ONLY`, `+typing`), so those features silently never turned on.
- **The WebSocket subprotocol was `irc`** rather than `text.ircv3.net`, which
  made the whole transport non-functional against a conformant server.
- **Metadata sent before registration**, so with SASL the profile silently never
  published — for exactly the users who have an account.

The phone's engine is a separate implementation and needed the same fixes, so
the two are held together by `tests/fixtures/` — one corpus for the protocol,
the capability list and the pairing payload, read by both test suites.

### Pairing by camera

The desktop's QR carries `switchboard://pair?ticket=…&code=…`, so a scan is the
whole of pairing rather than a ticket plus six digits typed across from one
screen to another. That is safe in a way that showing the code alone is not: a
QR is read off the screen in front of you, and the window closes after five
minutes. The same URI works as a deep link, so a code scanned by the system
camera opens straight into pairing.

Decoding is CameraX plus ZXing's core — pure Java, half a megabyte, no Play
Services, which matters for a client people sideload.

### Making the failover unattended

The coordinator was correct from the start; the phone still could not stand in
for anything, for two reasons that only show up on a real device.

**The process does not survive being backgrounded.** Android demotes a
backgrounded activity's process to `cached` within a minute or two, freezes it,
and the IRC socket goes with it — measured directly: `oom_adj 900`, and the
phone silently off the network. The engine now belongs to the process rather
than to a screen, and a foreground service keeps it out of that bucket. Its
notification is the only way to see, without opening anything, which device is
currently connected.

**The vault key was memory-only, so any restart locked it.** That is the right
default and, for a standby device, not enough on its own: the system restarts
apps whenever it likes, and a phone that must be asked for a passphrase before
it can take over will sit beside a dead desktop doing nothing. The key can now
be kept, wrapped by a key in the Android Keystore that never leaves the device.
It is a choice, and the UI says what it costs: copying the app's files still
gets nothing, but anyone holding the unlocked phone can use it as you can.

Two smaller things the same testing turned up:

- **"Holding the connections" was claimed before anything was connected** —
  the badge went green when a connection *object* existed, not when one had
  registered. A user told the phone has it covered, while nothing is connected,
  is worse off than one told nothing.
- **The phone had no discovery window.** It assumed primacy at startup and
  dialled out before hearing from a desktop it was already paired with — the
  same bug the desktop had, and the same fix.

### Doze

The heartbeat stops when the phone sleeps: with the screen off and the device
still, Android suspends network access, ignores wake locks and defers timers. A
desktop that dies at midnight would go unnoticed until morning. Four things
address it, in order of how much they help:

1. **Being exempt from battery optimisation.** The user grants it once and Doze
   stops applying. Nothing else comes close, which is why the app asks plainly —
   and only while it is actually a problem, so the card is not one people learn
   to skip.
2. **Saying goodbye.** A desktop closing on purpose now tells the phone rather
   than letting it wait out the timeout. Measured at about a tenth of a second
   against sixteen. It has to stop beating *before* it speaks: saying goodbye
   while still listening had the departing device claim the connection straight
   back off the phone that had just taken it.
3. **An alarm that fires anyway.** `setExactAndAllowWhileIdle` is allowed
   through Doze, roughly every nine minutes. That turns "never notices" into
   "notices within a quarter of an hour".
4. **Reacting the moment Doze lifts** — the cheapest chance to re-check, and it
   costs nothing to take.

What is still missing is a push wake-up, which is the only thing that makes the
worst case minutes rather than a quarter of an hour.

### Reactions, replies and typing

The Android client can now do what its engine could already carry: long-press a
message to reply, react, copy or delete it; a reply quotes the line it answers;
typing indicators show and are sent; a redacted message leaves a tombstone
rather than vanishing, because a message that silently disappears reads as a
bug. Channels can be joined from the phone.

Wiring that up found that **reactions had never worked on either client**. The
desktop parsed a TAGMSG into a `react` event and the manager never forwarded it,
so nothing downstream ever saw one — while the renderer had rendering code for
reactions sitting unused the whole time. Both clients now use one event name and
shape, and both spellings of each client tag are accepted (`+draft/react` and
`+react`, and so on): these specs are drafts, implementations disagree about the
prefix, and a reaction that silently does not arrive is indistinguishable from
one nobody sent.

Two things the spike settled that the plan above only guessed at:

- The npm package is `@number0/iroh` (prebuilt N-API binaries, no rebuild needed
  for Electron) and the Android artifact is `computer.iroh:iroh-android`, which
  ships arm64-v8a, armeabi-v7a, x86 and x86_64 — so the emulator works too.
- iroh's native library must be listed in `asarUnpack` or the packaged desktop
  build loses the remote link silently.

## What we already have that helps

Switchboard is already split the way this needs it to be split:

| Piece | Where it lives | Notes |
|---|---|---|
| IRC connections, CAP negotiation, SASL | main process (`src/main/irc/`) | never touches the UI |
| Message/channel/server storage | main process (`src/main/storage/`) | SQLite via sql.js |
| Everything the UI can ask for | `RendererToMainInvocations` in `src/shared/types/ipc.ts` | ~40 typed calls |
| Everything the UI is told about | `MainToRendererEvents` | ~35 typed events |

The renderer already talks to the core over a narrow, fully typed, serialisable boundary and holds
no IRC state of its own — it rebuilds from `app:renderer-ready` on every reload. **That contract is
the remote protocol.** An Android client is, architecturally, a second renderer that happens to be
on the other side of a network link rather than an Electron IPC channel.

That is the whole reason this plan is realistic. The work is a transport plus an auth layer, not a
rewrite.

```
                        ┌─────────────────────────────┐
   IRC networks ────────┤  Switchboard core (desktop) │
                        │  connections · store · caps │
                        └──────┬───────────────┬──────┘
                     Electron IPC            P2P link
                               │               │
                     ┌─────────┴──────┐  ┌─────┴────────┐
                     │ desktop UI     │  │ Android UI   │
                     └────────────────┘  └──────────────┘
```

---

## Track A — Android companion

### A1. Transports considered

The requirement is a direct link between two devices that are both usually behind NAT, with no
router configuration, and no user-visible "server".

**iroh (recommended).** A QUIC-based P2P stack where you dial a peer by its public key rather than
an address. It tries a direct UDP hole punch first and falls back to encrypted relays when that
fails, so a connection essentially always succeeds even if it is not always direct. It reached 1.0
in June 2026 with wire-protocol stability, and — the deciding factor here — ships **first-party
Node.js and Kotlin bindings**, which is exactly the pair of languages this project needs.

- Node/Electron: `npm install @number0/iroh` — `new EndpointBuilder().build()`, `endpoint.start()`,
  `endpoint.nodeId()`, `endpoint.connect(ticket)`, `connection.openBiStream()`.
- Android: Kotlin package `computer.iroh`, JVM/Android supported.
- n0 publish ~90% direct-connection success with relay fallback for the rest; they run public relay
  infrastructure, and relays are self-hostable if we don't want that dependency.

**libp2p.** The most mature decentralised option, and DCUtR does hole punching without a signalling
server. Independent large-scale measurement in IPFS puts DCUtR's success rate around **70%**, and
libp2p is a much larger surface to carry for what is fundamentally one connection between two
devices that already trust each other. Rust/Go first; JS and Kotlin support is weaker.

**WebRTC data channels.** Everything is there (DTLS-encrypted `RTCDataChannel`, mature on Android
and in Chromium — which we already ship), and QR-code signalling for pairing is a proven trick. But
we would still need STUN plus a TURN relay for the symmetric-NAT cases, i.e. we end up operating
the same relay infrastructure iroh already operates, and writing our own reconnection and identity
layer on top. Reasonable fallback; more moving parts.

**Tailscale via `tsnet`.** Embeds a full Tailscale node in a process — no daemon, no root, userspace
netstack. Genuinely excellent connectivity, but it is a Go library (awkward from Electron), and it
puts the user's identity in a third-party control plane, which is the opposite of "one login".

**A bouncer (soju/ZNC) on a VPS.** The honest baseline: it solves multi-device properly today and
`soju` already implements `soju.im/bouncer-networks` and webpush for phones. It fails the stated
requirement — it is another host to run and expose. Worth keeping as a documented alternative for
users who already have one, and worth stealing ideas from regardless.

**Recommendation: iroh**, with the WebRTC path kept in mind as a fallback if the bindings disappoint
in practice. The prototype in A5 is deliberately shaped to keep the transport swappable.

### A2. Pairing and identity

1. Desktop generates a long-lived device keypair on first run; its iroh node id is the public half.
2. "Add a device" shows a QR code containing a **pairing ticket**: node id + relay hint + a
   single-use, short-lived pairing secret.
3. Phone scans it, connects, and both sides run a short authenticated handshake keyed by the
   pairing secret so the transport identity is bound to the human act of scanning.
4. On success each side stores the other's public key. The pairing secret is discarded; from then on
   the phone dials the desktop by key alone.
5. The desktop keeps a device list — name, first seen, last seen — and can revoke any of them.
   Revocation must also invalidate the session key, not just remove the row.

No account, no server-side identity, no shared password. The IRC credentials never leave the
desktop: the phone never learns them, which is a real security win over "log in twice".

### A3. The protocol

Reuse the IPC contract rather than inventing a second one:

- Frame `{ id, channel, args }` for invocations and `{ channel, data }` for events, over one iroh
  bidirectional stream, length-prefixed, CBOR or JSON.
- The Android client implements the same `switchboard` API shape the renderer uses, so the same
  server/channel/message semantics apply on both ends.
- On connect the phone calls `app:renderer-ready` and gets the same snapshot the desktop UI uses to
  rebuild after a reload. That mechanism already exists and is already tested.
- Add capability negotiation from day one (`protocol version`, feature flags) so an old phone and a
  new desktop degrade gracefully.

Two things need adding to the core rather than reused as-is:

- **Per-device read state.** Read markers are currently global to the install. Two devices need
  either per-device markers or a "last read wins with device attribution" rule, or the phone will
  keep marking things read on the desktop and vice versa.
- **History paging over the link.** `history:fetch` is fine for a page at a time, but the phone
  should not pull an entire channel on every connect. Cache locally, then request deltas.

### A4. The genuinely hard part: Android background execution

This is where the design lives or dies, and it is worth being blunt about it.

Android will not let an app hold a socket open indefinitely. Under Doze the system suspends network
access for idle apps, so a persistent QUIC connection dies whenever the screen is off and the phone
is still. The supported ways to be woken are:

- **A foreground service** with a persistent notification. Reliable while it lasts, visible to the
  user, and increasingly restricted by both Google and OEM battery managers.
- **A push message.** Google's guidance is explicit — do not maintain your own persistent connection
  for this, use FCM; a high-priority FCM message wakes the app and grants temporary network access
  even in Doze. Excessive high-priority use gets an app flagged, so this is for messages that
  actually matter to the user (mentions, DMs), not every line of chat.

A push message means a push server, which sits awkwardly next to "no servers". **UnifiedPush** is
the way out: it is a decentralised push protocol built on WebPush + VAPID where the *user* picks
their distributor — self-hosted ntfy, NextPush on their own Nextcloud, or an FCM-backed distributor
for people who just want it to work. It is well established in the Matrix and Mastodon ecosystems,
and it is what soju already does for phone clients. The desktop becomes the "app server" that posts
a VAPID-signed WebPush to whatever endpoint the phone registered — payload encrypted end to end, so
the distributor learns nothing but "something happened".

The second constraint is simpler and unavoidable: **the desktop is the proxy, so when the desktop is
off, the phone has nothing to talk to.** That has to be stated in the UI rather than discovered.
Options, in rough order of effort:

- Ship it as-is: the phone works when the desktop is awake. Fine for a desktop that stays on.
- Let the phone connect to IRC directly as a fallback when the desktop is unreachable, accepting a
  second connection and a `_mobile` nick suffix.
- Offer an optional self-hosted headless core (the same `src/main` code, no Electron window) that
  the user can run on a Pi or VPS — which is a bouncer, honestly labelled, and reuses everything.

### A5. Phasing

1. **Spike (1–2 weeks).** `@number0/iroh` in the main process, `computer.iroh` in a bare Kotlin app.
   Pair by QR, run one `server:list` round trip over the link, and measure: direct vs relayed, on
   mobile data, on a hotel/CGNAT network, after a device sleeps and wakes.
2. **Extract a remote core.** A transport-agnostic dispatcher over the existing IPC contract, so the
   desktop renderer and a remote client go through the same code path. Device registry, pairing UI,
   revocation.
3. **Read-only Android client.** Channel list, history, live messages. No sending. This is where
   sync semantics and reconnection get proven.
4. **Sending, then notifications.** Composer, then UnifiedPush wake-ups for mentions and DMs.
5. **Decide on the headless core** based on how often testers hit "desktop asleep".

---

## Track B — Encryption at rest

### B0. Where we are, which is worse than it sounds

`~/.config/switchboard/switchboard.db` is a plain SQLite file, and there is no use of Electron's
`safeStorage` anywhere in the codebase today. That file currently contains, unencrypted:

- `servers.password` — server passwords
- `servers.sasl_password` — SASL passwords
- `servers.identify_command` — which is conventionally `/msg NickServ IDENTIFY <password>`
- every message ever received

Any process running as the user — any npm postinstall script, any browser extension host, any
backup tool — can read all of it. **Fixing the credentials is worth doing on its own, ahead of the
larger encryption work.**

### B1. Credentials first (small, do it now)

Electron's `safeStorage` encrypts a blob with a key held by the OS: Keychain on macOS, DPAPI on
Windows, and kwallet/gnome-libsecret on Linux. Store the three credential fields as
`safeStorage.encryptString()` ciphertext and decrypt them only when building a connection.

Caveats to handle rather than discover:

- On Linux, if no secret store is available, `safeStorage` degrades to a hardcoded key — check
  `safeStorage.getSelectedStorageBackend()` and tell the user plainly when the backend is
  `basic_text`, because in that state this is obfuscation, not encryption.
- On macOS the app must be code signed consistently or the Keychain re-prompts on every update.
- Needs a migration that re-encrypts existing plaintext rows and a fallback when decryption fails
  (prompt to re-enter, do not silently connect with an empty password).

### B2. Whole-database encryption

The mainstream answer for Electron is page-level transparent encryption via SQLCipher or SQLite3
Multiple Ciphers — ordinary SQL from the app's point of view, an opaque file on disk.
`better-sqlite3-multiple-ciphers` is the common pick (`@signalapp/sqlcipher` is the other credible
one). Both are native modules, which is fine here: the build already runs `@electron/rebuild`.

This is also a chance to leave **sql.js**, which is costing us more than encryption:

- it has no FTS5, so message search falls back to `LIKE` (see `searchMessages`);
- the whole database is held in memory and written out with `fs.writeFileSync` on every save, which
  will not scale to years of logs and risks a torn file on a crash.

Migration: open the old sql.js database, stream every table into a new encrypted `better-sqlite3`
database, verify row counts, keep the old file as `.bak` until the first clean run, then delete.
Do it once, on launch, behind a progress dialog.

Key handling: generate a random 32-byte database key, wrap it with `safeStorage`, and store the
wrapped blob beside the database. Optionally let the user set a passphrase that wraps the key
instead (Argon2id), for people who want the database sealed when the app is closed even against
their own OS account — with a loud warning that a forgotten passphrase means the history is gone.

### B3. Android side

Same shape, different primitives: SQLCipher for Android (or Jetpack Security's `EncryptedFile` for
blobs), with the key in the Android Keystore, `setUserAuthenticationRequired` optional so history
can be gated behind biometrics. The paired-device key from Track A lives here too, and must be
non-exportable.

### B4. What this does and does not protect

Worth writing into the docs so nobody over-trusts it:

- **Protects:** a stolen laptop or phone at rest, a backup that walks out of the house, other user
  accounts on the same machine, casual snooping by other apps (on macOS/Windows).
- **Does not protect:** anything while the app is running — the key is in memory and the database is
  open; malware running as your user; a compromised OS keychain; and on Linux without a working
  secret store, not much at all.
- Transport encryption (TLS to IRC, iroh's QUIC to the phone) is a separate axis and already
  handled; at-rest encryption is not a substitute for a network threat model.

---

## Decisions needed before starting

1. Does the phone ever talk to IRC directly, or is the desktop the only path? (Determines whether we
   need a second nick, and how much of the core the phone carries.)
2. Are we willing to depend on n0's public relays for the fallback path, or do we self-host relays
   from the start?
3. Is a headless core in scope, or is "desktop must be awake" an accepted limitation of v1?
4. Optional passphrase for the database, or OS-keystore only?
5. Push: UnifiedPush only, or FCM as well for people who want zero setup?

---

## Sources

- [Iroh 1.0: Dial Keys, Not IPs](https://pinggy.io/blog/iroh_1_0_dial_keys_not_ips/)
- [Iroh language support](https://www.iroh.computer/blog/iroh-language-support) ·
  [JS SDK](https://n0-computer.github.io/iroh-ffi/js/) ·
  [Kotlin SDK](https://n0-computer.github.io/iroh-ffi/kotlin/)
- [Comparing Iroh & libp2p](https://www.iroh.computer/blog/comparing-iroh-and-libp2p)
- [DCUtR](https://libp2p.io/docs/dcutr/) ·
  [libp2p hole punching](https://libp2p.io/docs/hole-punching/) ·
  [Large-scale measurement of NAT traversal (DCUtR in IPFS)](https://arxiv.org/pdf/2604.12484)
- [Optimize for Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)
- [UnifiedPush](https://unifiedpush.org/) ·
  [Push for decentralized services](https://unifiedpush.org/news/20250131_push_for_decentralized/) ·
  [ntfy as a distributor](https://unifiedpush.org/users/distributors/ntfy/)
- [soju IRC bouncer](https://soju.im/) · [soju on GitHub](https://github.com/emersion/soju)
- [tsnet](https://tailscale.com/docs/features/tsnet)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [better-sqlite3-multiple-ciphers](https://github.com/m4heshd/better-sqlite3-multiple-ciphers) ·
  [comparison of encrypted SQLite libraries for Electron](https://codenote.net/en/posts/electron-encrypted-sqlite-libraries-comparison/)
