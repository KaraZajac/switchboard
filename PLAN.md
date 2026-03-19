# Switchboard — Implementation Plan

## Project Vision

Switchboard is a modern, cross-platform IRC client built with Electron that provides a Discord-like user experience while fully implementing the IRCv3 specification. It targets Linux, macOS, and Windows.

---

## UI Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Server  │  Channel    │          Chat Area            │   Users    │
│  Rail    │  Sidebar    │                               │   List     │
│          │             │  ┌─────────────────────────┐  │            │
│  [icon]  │  # general  │  │ <nick> message           │  │  @ops      │
│  [icon]  │  # dev      │  │ <nick> message           │  │  +voiced   │
│  [icon]  │  # random   │  │ <nick> message           │  │  users     │
│          │             │  │                           │  │            │
│          │  ▸ Voice     │  └─────────────────────────┘  │            │
│          │             │  ┌─────────────────────────┐  │            │
│   [+]    │             │  │ Message input / compose  │  │            │
│          │             │  └─────────────────────────┘  │            │
└──────────────────────────────────────────────────────────────────────┘
```

### Pane Descriptions

1. **Server Rail** (far left, narrow icon strip)
   - Each connected server shown as an icon/avatar
   - Click to switch active server context
   - "+" button to add a new server
   - Unread indicators / mention badges per server
   - Drag to reorder

2. **Channel Sidebar** (left of chat)
   - Grouped: Text Channels, Voice Channels (if applicable — IRC has no native voice, but we can group by prefix or user-defined categories)
   - Channel list for the active server
   - Unread bold, mention badges
   - Collapsible category headers (user-configurable)
   - Right-click context menu: leave, mute, settings

3. **Chat Area** (center, dominant)
   - Message history with infinite scroll (backed by chathistory when available)
   - Timestamps (from `server-time` tag)
   - Threaded replies (via `+reply` tag)
   - Reactions (via `+draft/react`)
   - Typing indicators (via `+typing`)
   - Inline embeds: URLs with previews, images, code blocks
   - Netsplit/netjoin collapsed into summary events
   - Message compose bar at bottom with markdown-like formatting
   - Read marker line ("new messages since…")

4. **Users List** (right pane)
   - Grouped by prefix rank: Owners (~), Admins (&), Ops (@), Halfops (%), Voiced (+), Regular
   - Shows away status (dimmed or icon, from `away-notify`)
   - Bot badge (from `bot-mode`)
   - Account name tooltip (from `account-tag`)
   - Right-click: whois, PM, kick/ban (if op)
   - Online count header

---

## Technology Stack

| Layer              | Choice                        | Rationale                                                  |
| ------------------ | ----------------------------- | ---------------------------------------------------------- |
| Runtime            | **Electron 33+**              | Cross-platform desktop, mature ecosystem                   |
| Language           | **TypeScript 5.x** (strict)   | Type safety across main + renderer                         |
| Renderer framework | **React 19**                  | Component model fits Discord-like UI                       |
| State management   | **Zustand**                   | Lightweight, minimal boilerplate, good for complex state   |
| Styling            | **Tailwind CSS 4**            | Utility-first, easy theming (dark/light)                   |
| Build / bundle     | **Vite + electron-vite**      | Fast HMR, native ESM                                       |
| IRC protocol       | Custom TypeScript library     | Full IRCv3 control; no existing lib covers all specs       |
| TLS                | Node.js `tls` module          | Native TLS support, STS compliance                         |
| WebSocket          | `ws` library                  | For servers that support WebSocket transport                |
| Storage            | **SQLite via better-sqlite3** | Chat history, settings, connection state — fast & embedded |
| Testing            | **Vitest**                    | Fast, Vite-native, good TS support                         |
| Linting            | **ESLint 9 + Prettier**       | Flat config, consistent formatting                         |
| Packaging          | **electron-builder**          | Linux (AppImage/deb/rpm), macOS (dmg), Windows (NSIS/MSI)  |

---

## Architecture

### Process Model (Electron)

```
┌─────────────────────────────────────────┐
│              Main Process               │
│                                         │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │ IRC Engine   │  │ Storage Layer    │  │
│  │ (connections │  │ (SQLite)         │  │
│  │  per server) │  │                  │  │
│  └──────┬──────┘  └────────┬─────────┘  │
│         │    IPC Bridge     │            │
│         └────────┬──────────┘            │
└──────────────────┼───────────────────────┘
                   │ contextBridge / ipcRenderer
┌──────────────────┼───────────────────────┐
│           Renderer Process               │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  React App                       │    │
│  │  ┌────────┐ ┌────────┐ ┌──────┐ │    │
│  │  │ Stores │ │ Views  │ │ Hook │ │    │
│  │  │(Zustand)│ │        │ │  s   │ │    │
│  │  └────────┘ └────────┘ └──────┘ │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

### Key Architectural Decisions

1. **IRC connections live in the Main process** — TCP/TLS sockets can't run in the renderer. Each server connection is an independent `IRCConnection` instance.

2. **IPC is the only bridge** — Renderer never touches sockets or DB directly. All communication goes through typed IPC channels via `contextBridge`.

3. **Custom IRC library** — No existing npm IRC library supports the full IRCv3 spec (especially drafts like chathistory, multiline, reactions, read markers). We build our own protocol layer with:
   - Message parser/serializer (tags, prefix, command, params)
   - Capability negotiation state machine
   - SASL authentication handler
   - Per-capability feature modules

4. **SQLite for persistence** — Stores: server configs, channel state, message history (for offline/scroll-back), user preferences, STS policy cache, read markers.

5. **Event-driven architecture** — IRC engine emits typed events → Main process handles business logic → IPC forwards relevant updates to renderer → Zustand stores update → React re-renders.

---

## Directory Structure

```
switchboard/
├── electron-builder.yml          # Build/packaging config
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
├── vite.config.ts                # electron-vite config
├── PLAN.md
├── README.md
├── src/
│   ├── main/                     # Electron main process
│   │   ├── index.ts              # Entry point, window creation
│   │   ├── ipc/                  # IPC handler registrations
│   │   │   ├── index.ts
│   │   │   ├── connection.ts     # Connect/disconnect/reconnect
│   │   │   ├── channels.ts       # Join/part/topic/mode
│   │   │   ├── messages.ts       # Send/receive messages
│   │   │   ├── settings.ts       # Read/write settings
│   │   │   └── users.ts          # Whois, monitor, etc.
│   │   ├── irc/                  # IRC protocol engine
│   │   │   ├── index.ts
│   │   │   ├── connection.ts     # TCP/TLS/WS socket management
│   │   │   ├── parser.ts         # IRCv3 message parser
│   │   │   ├── serializer.ts     # Message serializer
│   │   │   ├── capability.ts     # CAP negotiation state machine
│   │   │   ├── sasl.ts           # SASL authentication
│   │   │   ├── state.ts          # Per-connection state tracking
│   │   │   ├── handlers/         # Command/numeric handlers
│   │   │   │   ├── index.ts
│   │   │   │   ├── registration.ts
│   │   │   │   ├── channel.ts
│   │   │   │   ├── message.ts
│   │   │   │   ├── user.ts
│   │   │   │   ├── batch.ts
│   │   │   │   └── error.ts
│   │   │   └── features/         # IRCv3 feature modules
│   │   │       ├── account.ts    # account-notify, account-tag, extended-join
│   │   │       ├── away.ts       # away-notify
│   │   │       ├── batch.ts      # batch processing
│   │   │       ├── bot.ts        # bot-mode
│   │   │       ├── chathistory.ts
│   │   │       ├── chghost.ts
│   │   │       ├── echo.ts       # echo-message
│   │   │       ├── invite.ts     # invite-notify
│   │   │       ├── labeled.ts    # labeled-response
│   │   │       ├── monitor.ts    # monitor + extended-monitor
│   │   │       ├── multiline.ts  # draft/multiline
│   │   │       ├── reactions.ts  # +draft/react
│   │   │       ├── readmarker.ts # draft/read-marker
│   │   │       ├── redact.ts     # draft/message-redaction
│   │   │       ├── rename.ts     # draft/channel-rename
│   │   │       ├── reply.ts      # +reply
│   │   │       ├── sasl.ts       # SASL 3.2 enhancements
│   │   │       ├── setname.ts
│   │   │       ├── sts.ts        # strict-transport-security
│   │   │       ├── typing.ts     # +typing
│   │   │       └── whox.ts
│   │   └── storage/              # SQLite data layer
│   │       ├── index.ts
│   │       ├── database.ts       # Connection, migrations
│   │       ├── models/
│   │       │   ├── server.ts
│   │       │   ├── channel.ts
│   │       │   ├── message.ts
│   │       │   ├── user.ts
│   │       │   └── settings.ts
│   │       └── migrations/
│   │           └── 001_initial.ts
│   ├── preload/                  # Electron preload scripts
│   │   ├── index.ts              # contextBridge API exposure
│   │   └── api.ts                # Typed API definition
│   ├── renderer/                 # React UI
│   │   ├── index.html
│   │   ├── main.tsx              # React entry
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── AppLayout.tsx
│   │   │   │   ├── ServerRail.tsx
│   │   │   │   ├── ChannelSidebar.tsx
│   │   │   │   ├── ChatArea.tsx
│   │   │   │   ├── UserList.tsx
│   │   │   │   └── TitleBar.tsx
│   │   │   ├── chat/
│   │   │   │   ├── MessageList.tsx
│   │   │   │   ├── MessageItem.tsx
│   │   │   │   ├── MessageComposer.tsx
│   │   │   │   ├── TypingIndicator.tsx
│   │   │   │   ├── ReplyPreview.tsx
│   │   │   │   ├── Reactions.tsx
│   │   │   │   ├── ReadMarker.tsx
│   │   │   │   └── SystemEvent.tsx
│   │   │   ├── server/
│   │   │   │   ├── ServerIcon.tsx
│   │   │   │   ├── AddServerModal.tsx
│   │   │   │   └── ServerContextMenu.tsx
│   │   │   ├── channel/
│   │   │   │   ├── ChannelItem.tsx
│   │   │   │   ├── ChannelHeader.tsx
│   │   │   │   └── TopicDisplay.tsx
│   │   │   ├── user/
│   │   │   │   ├── UserItem.tsx
│   │   │   │   ├── UserProfile.tsx
│   │   │   │   └── UserContextMenu.tsx
│   │   │   ├── settings/
│   │   │   │   ├── SettingsModal.tsx
│   │   │   │   ├── ServerSettings.tsx
│   │   │   │   ├── AppearanceSettings.tsx
│   │   │   │   ├── NotificationSettings.tsx
│   │   │   │   └── IdentitySettings.tsx
│   │   │   └── common/
│   │   │       ├── Modal.tsx
│   │   │       ├── ContextMenu.tsx
│   │   │       ├── Badge.tsx
│   │   │       ├── Tooltip.tsx
│   │   │       └── ScrollArea.tsx
│   │   ├── stores/
│   │   │   ├── serverStore.ts
│   │   │   ├── channelStore.ts
│   │   │   ├── messageStore.ts
│   │   │   ├── userStore.ts
│   │   │   ├── uiStore.ts
│   │   │   └── settingsStore.ts
│   │   ├── hooks/
│   │   │   ├── useIRC.ts         # IPC bridge hook
│   │   │   ├── useMessages.ts
│   │   │   ├── useChannel.ts
│   │   │   ├── useUsers.ts
│   │   │   └── useSettings.ts
│   │   ├── styles/
│   │   │   ├── globals.css
│   │   │   └── themes/
│   │   │       ├── dark.css
│   │   │       └── light.css
│   │   └── utils/
│   │       ├── formatting.ts     # IRC color codes, markdown
│   │       ├── linkify.ts        # URL detection, embeds
│   │       └── time.ts           # Timestamp formatting
│   └── shared/                   # Types shared between main & renderer
│       ├── types/
│       │   ├── irc.ts            # IRC message types
│       │   ├── server.ts         # Server config types
│       │   ├── channel.ts
│       │   ├── message.ts
│       │   ├── user.ts
│       │   └── ipc.ts            # IPC channel definitions
│       └── constants.ts
├── resources/                    # App icons, assets
│   └── icon.png
└── tests/
    ├── main/
    │   ├── parser.test.ts
    │   ├── serializer.test.ts
    │   ├── capability.test.ts
    │   └── sasl.test.ts
    └── renderer/
        └── components/
```

---

## IRCv3 Implementation Roadmap

### Phase 1 — Core Protocol & Connection (Weeks 1–2)

**Goal:** Connect to an IRC server, register, join channels, send/receive messages.

| # | Task | Spec |
|---|------|------|
| 1.1 | IRC message parser (tags, prefix, command, params) | RFC 1459 / Modern IRC |
| 1.2 | IRC message serializer | RFC 1459 / Modern IRC |
| 1.3 | TCP + TLS socket management with reconnection | — |
| 1.4 | Connection registration (NICK, USER, PASS) | Modern IRC |
| 1.5 | PING/PONG keepalive | Modern IRC |
| 1.6 | Basic channel operations (JOIN, PART, KICK, NAMES, TOPIC, MODE) | Modern IRC |
| 1.7 | PRIVMSG and NOTICE sending/receiving | Modern IRC |
| 1.8 | Numeric reply handling (001–005, 353, 366, 372, 375, 376, 4xx) | Modern IRC |
| 1.9 | QUIT handling | Modern IRC |
| 1.10 | MOTD display | Modern IRC |
| 1.11 | ISUPPORT (005) parsing and storage | Modern IRC |

### Phase 2 — Capability Negotiation & Auth (Weeks 2–3)

**Goal:** Full CAP 302 negotiation, SASL auth, STS.

| # | Task | Spec |
|---|------|------|
| 2.1 | CAP LS 302, REQ, ACK, NAK, END, LIST | `cap` |
| 2.2 | CAP NEW / DEL (dynamic capability changes) | `cap-notify` |
| 2.3 | SASL PLAIN authentication | `sasl 3.1/3.2` |
| 2.4 | SASL EXTERNAL (client cert) | `sasl 3.2` |
| 2.5 | SASL SCRAM-SHA-256 | `sasl 3.2` |
| 2.6 | STS policy enforcement and caching | `sts` |
| 2.7 | Standard Replies (FAIL/WARN/NOTE) handling | `standard-replies` |

### Phase 3 — Electron Shell & Basic UI (Weeks 3–5)

**Goal:** Electron app with the 4-pane Discord-like layout, functional chat.

| # | Task |
|---|------|
| 3.1 | Electron main process setup (window, menu, tray) |
| 3.2 | IPC bridge with typed channels (contextBridge) |
| 3.3 | React app scaffold with Vite |
| 3.4 | AppLayout — 4-pane grid |
| 3.5 | ServerRail — server icons, add button, switching |
| 3.6 | ChannelSidebar — channel list, categories, unread state |
| 3.7 | ChatArea — message list, auto-scroll, timestamps |
| 3.8 | MessageComposer — input, send on Enter, multiline Shift+Enter |
| 3.9 | UserList — grouped by prefix rank |
| 3.10 | Settings modal — server config (address, port, TLS, nick, SASL creds) |
| 3.11 | SQLite integration — persist server configs and channel state |
| 3.12 | Dark theme (default) + light theme toggle |

### Phase 4 — User Tracking & Presence (Weeks 5–6)

**Goal:** Rich user presence, just like Discord's member list.

| # | Task | Spec |
|---|------|------|
| 4.1 | `multi-prefix` — show all mode prefixes | `multi-prefix` |
| 4.2 | `userhost-in-names` — full hostmasks in NAMES | `userhost-in-names` |
| 4.3 | `extended-join` — account + realname on JOIN | `extended-join` |
| 4.4 | `account-notify` — track login/logout | `account-notify` |
| 4.5 | `account-tag` — show account on messages | `account-tag` |
| 4.6 | `away-notify` — live away status updates | `away-notify` |
| 4.7 | `chghost` — handle host/user changes | `chghost` |
| 4.8 | `setname` — handle realname changes | `setname` |
| 4.9 | `monitor` + `extended-monitor` — friend list / notifications | `monitor` |
| 4.10 | `invite-notify` — show channel invites | `invite-notify` |
| 4.11 | `bot-mode` — bot badges in user list | `bot-mode` |
| 4.12 | WHOX queries for efficient user info | `whox` |

### Phase 5 — Message Features (Weeks 6–8)

**Goal:** Modern messaging features matching Discord UX.

| # | Task | Spec |
|---|------|------|
| 5.1 | `message-tags` — full tag parsing/serialization | `message-tags` |
| 5.2 | `server-time` — use server timestamps | `server-time` |
| 5.3 | `message-ids` — track messages by ID | `message-ids` |
| 5.4 | `echo-message` — delivery confirmation, pending state | `echo-message` |
| 5.5 | `batch` — batch processing with nesting | `batch` |
| 5.6 | `labeled-response` — request/response correlation | `labeled-response` |
| 5.7 | `+reply` — threaded reply display | `+reply` |
| 5.8 | `+typing` — typing indicators | `+typing` |
| 5.9 | Netsplit/netjoin batch collapsing | `netsplit`/`netjoin` |
| 5.10 | `utf8only` — encoding handling | `utf8-only` |
| 5.11 | IRC color code rendering (mIRC colors → styled spans) | — |
| 5.12 | URL detection and inline link previews | — |
| 5.13 | Image embed previews | — |
| 5.14 | Code block rendering | — |

### Phase 6 — History & Sync (Weeks 8–9)

**Goal:** Scrollback, read position sync, persistent history.

| # | Task | Spec |
|---|------|------|
| 6.1 | `chathistory` — BEFORE/AFTER/LATEST/BETWEEN/TARGETS | `draft/chathistory` |
| 6.2 | History stored in SQLite with message IDs | — |
| 6.3 | Infinite scroll loading from local DB + server history | — |
| 6.4 | `draft/read-marker` — sync read position | `draft/read-marker` |
| 6.5 | "New messages" divider line in chat | — |
| 6.6 | Search within history (local SQLite FTS) | — |

### Phase 7 — Draft/Experimental Features (Weeks 9–11)

**Goal:** Cutting-edge IRCv3 features.

| # | Task | Spec |
|---|------|------|
| 7.1 | `draft/multiline` — multiline message sending | `draft/multiline` |
| 7.2 | `+draft/react` — emoji reactions | `+draft/react` |
| 7.3 | `draft/message-redaction` — message deletion | `draft/message-redaction` |
| 7.4 | `draft/channel-rename` — handle channel renames | `draft/channel-rename` |
| 7.5 | `draft/account-registration` — register from client | `draft/account-registration` |
| 7.6 | `account-extban` — display extban info | `account-extban` |
| 7.7 | `+draft/channel-context` — channel-aware PMs | `+draft/channel-context` |
| 7.8 | WebSocket transport support | `websocket` |

### Phase 8 — Settings, Polish & UX (Weeks 11–13)

**Goal:** Full settings UI, notifications, polish.

| # | Task |
|---|------|
| 8.1 | Settings: manage multiple servers (add/edit/remove/reorder) |
| 8.2 | Settings: per-server identity (nick, user, realname, SASL) |
| 8.3 | Settings: auto-join channels per server |
| 8.4 | Settings: appearance (theme, font size, compact mode, timestamps) |
| 8.5 | Settings: notifications (desktop, sound, per-channel mute) |
| 8.6 | Settings: network (proxy support, custom TLS certs) |
| 8.7 | Keyboard shortcuts (Ctrl+K channel switcher, Ctrl+/ shortcuts list) |
| 8.8 | Desktop notifications with mention highlighting |
| 8.9 | System tray with unread badge |
| 8.10 | Nick completion (Tab) in composer |
| 8.11 | Channel completion (Tab) in composer |
| 8.12 | Command completion (/ commands) |
| 8.13 | Drag-and-drop file sharing (via DCC or external upload) |
| 8.14 | Custom CSS / theme import |

### Phase 9 — Packaging & Distribution (Weeks 13–14)

**Goal:** Release-ready builds for all platforms.

| # | Task |
|---|------|
| 9.1 | electron-builder config for Linux (AppImage, .deb, .rpm) |
| 9.2 | electron-builder config for macOS (.dmg, universal binary) |
| 9.3 | electron-builder config for Windows (NSIS installer, portable) |
| 9.4 | Auto-update via electron-updater |
| 9.5 | Code signing (macOS notarization, Windows Authenticode) |
| 9.6 | CI/CD pipeline (GitHub Actions: lint, test, build, release) |
| 9.7 | First-run onboarding flow (add a server, connect) |

---

## Database Schema (SQLite)

```sql
-- Server configurations
CREATE TABLE servers (
  id            TEXT PRIMARY KEY,   -- UUID
  name          TEXT NOT NULL,      -- Display name
  host          TEXT NOT NULL,
  port          INTEGER NOT NULL DEFAULT 6697,
  tls           INTEGER NOT NULL DEFAULT 1,
  password      TEXT,               -- Server password (encrypted)
  nick          TEXT NOT NULL,
  username      TEXT,
  realname      TEXT,
  sasl_mechanism TEXT,              -- PLAIN, EXTERNAL, SCRAM-SHA-256
  sasl_username TEXT,
  sasl_password TEXT,               -- Encrypted
  auto_connect  INTEGER NOT NULL DEFAULT 0,
  auto_join     TEXT,               -- JSON array of channels
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- STS policy cache
CREATE TABLE sts_policies (
  host          TEXT PRIMARY KEY,
  port          INTEGER NOT NULL,
  duration      INTEGER NOT NULL,   -- seconds
  cached_at     TEXT NOT NULL
);

-- Channel state
CREATE TABLE channels (
  id            TEXT PRIMARY KEY,
  server_id     TEXT NOT NULL REFERENCES servers(id),
  name          TEXT NOT NULL,
  topic         TEXT,
  topic_set_by  TEXT,
  topic_set_at  TEXT,
  modes         TEXT,               -- JSON
  joined        INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  muted         INTEGER NOT NULL DEFAULT 0,
  category      TEXT,
  UNIQUE(server_id, name)
);

-- Message history
CREATE TABLE messages (
  id            TEXT PRIMARY KEY,   -- msgid from server or generated UUID
  server_id     TEXT NOT NULL REFERENCES servers(id),
  channel       TEXT NOT NULL,      -- Channel name or nick for PMs
  nick          TEXT NOT NULL,
  user_host     TEXT,
  content       TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'privmsg', -- privmsg, notice, action, system
  tags          TEXT,               -- JSON of message tags
  reply_to      TEXT,               -- msgid of parent message
  timestamp     TEXT NOT NULL,      -- ISO 8601 from server-time
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_channel ON messages(server_id, channel, timestamp);
CREATE INDEX idx_messages_reply ON messages(reply_to);

-- Read markers
CREATE TABLE read_markers (
  server_id     TEXT NOT NULL REFERENCES servers(id),
  channel       TEXT NOT NULL,
  timestamp     TEXT NOT NULL,
  PRIMARY KEY (server_id, channel)
);

-- User preferences
CREATE TABLE settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL       -- JSON value
);

-- Monitor list (friend list)
CREATE TABLE monitor_list (
  server_id     TEXT NOT NULL REFERENCES servers(id),
  nick          TEXT NOT NULL,
  PRIMARY KEY (server_id, nick)
);
```

---

## IPC Channel Definitions

```typescript
// Main → Renderer (events pushed to UI)
'irc:connected'          // { serverId }
'irc:disconnected'       // { serverId, reason }
'irc:message'            // { serverId, channel, message }
'irc:join'               // { serverId, channel, user }
'irc:part'               // { serverId, channel, user, reason }
'irc:quit'               // { serverId, user, reason }
'irc:nick'               // { serverId, oldNick, newNick }
'irc:topic'              // { serverId, channel, topic, setBy }
'irc:mode'               // { serverId, channel, mode, params }
'irc:kick'               // { serverId, channel, user, by, reason }
'irc:names'              // { serverId, channel, users[] }
'irc:away'               // { serverId, nick, message }
'irc:account'            // { serverId, nick, account }
'irc:typing'             // { serverId, channel, nick, status }
'irc:batch'              // { serverId, type, messages[] }
'irc:error'              // { serverId, code, message }
'irc:motd'               // { serverId, lines[] }
'irc:whois'              // { serverId, data }
'irc:react'              // { serverId, channel, nick, msgid, emoji }
'irc:redact'             // { serverId, channel, msgid }
'irc:read-marker'        // { serverId, channel, timestamp }
'irc:cap'                // { serverId, capabilities }
'irc:raw'                // { serverId, line } (for debug/raw view)

// Renderer → Main (user actions)
'server:connect'         // { serverId }
'server:disconnect'      // { serverId }
'server:add'             // { config }
'server:update'          // { serverId, config }
'server:remove'          // { serverId }
'channel:join'           // { serverId, channel, key? }
'channel:part'           // { serverId, channel }
'channel:topic'          // { serverId, channel, topic }
'message:send'           // { serverId, channel, text }
'message:reply'          // { serverId, channel, text, replyTo }
'message:react'          // { serverId, channel, msgid, emoji }
'message:redact'         // { serverId, channel, msgid, reason? }
'message:typing'         // { serverId, channel }
'user:whois'             // { serverId, nick }
'user:kick'              // { serverId, channel, nick, reason? }
'user:mode'              // { serverId, channel, nick, mode }
'user:monitor-add'       // { serverId, nick }
'user:monitor-remove'    // { serverId, nick }
'history:fetch'          // { serverId, channel, before?, limit? }
'settings:get'           // { key }
'settings:set'           // { key, value }
'read-marker:set'        // { serverId, channel, timestamp }
```

---

## Security Considerations

- **No plaintext passwords in storage** — encrypt SASL/server passwords with a key derived from OS keychain (Electron `safeStorage`)
- **STS enforcement** — never fall back to plaintext after a valid STS policy is cached
- **Certificate validation** — reject invalid TLS certs by default; allow user override with warning
- **contextBridge isolation** — renderer has zero access to Node APIs; all access through typed preload API
- **Input sanitization** — prevent IRC injection (newlines in user input)
- **CSP** — strict Content Security Policy in renderer to prevent XSS
- **No eval** — disable `eval` and `new Function` in renderer

---

## Open Questions / Future Ideas

- [ ] DCC file transfers — complex, security concerns; consider external upload services instead
- [ ] IRCv3 `draft/metadata-2` — implement when spec stabilizes
- [ ] Plugin/extension system — allow user scripts/themes
- [ ] Mobile companion (React Native sharing renderer code)
- [ ] End-to-end encryption (OTR/OMEMO adapted for IRC)
- [ ] Voice/video via WebRTC (non-standard, but interesting)

---

## Definition of Done (v1.0)

A release-ready v1.0 must have:

- [x] Phase 1–6 fully implemented and tested
- [x] Phase 7 items 7.1–7.4 implemented (core drafts)
- [x] Phase 8 items 8.1–8.12 implemented
- [x] Phase 9 builds for all three platforms
- [ ] Tested against: Ergo (modern), InspIRCd, UnrealIRCd, Libera Chat
- [ ] < 200ms message render latency
- [ ] < 150MB RAM baseline (idle, 5 servers)
- [ ] Accessibility: keyboard-navigable, screen reader labels
- [ ] No critical/high security issues
