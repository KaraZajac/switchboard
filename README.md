# Switchboard

A modern, cross-platform IRC client with a Discord-like interface, built on Electron and fully implementing the IRCv3 specification.

![Status](https://img.shields.io/badge/status-alpha-orange)
![Platform](https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Discord-like UI** — Server rail, channel sidebar, chat area, and user list in a familiar 4-pane layout
- **Full IRCv3 support** — CAP 302 negotiation, SASL authentication (PLAIN/EXTERNAL/SCRAM-SHA-256), STS, message tags, labeled-response, batch processing, and more
- **Multi-server** — Connect to multiple IRC networks simultaneously
- **Rich text** — IRC color codes, bold/italic/underline/strikethrough/monospace rendering, inline code, code blocks, URL detection with image previews
- **Modern messaging** — Threaded replies, emoji reactions, typing indicators, read markers, message redaction
- **Rich presence** — Away status, account tracking, bot badges, friend list via MONITOR, WHOX user queries
- **Message history** — Local SQLite storage with server-side chathistory support
- **Themes** — Dark (default) and light themes
- **Cross-platform** — Linux, macOS, and Windows

## Tech Stack

| Layer | Technology |
|-------|------------|
| Shell | Electron 33 |
| Language | TypeScript (strict mode) |
| UI | React 19 + Zustand 5 |
| Styling | Tailwind CSS 4 |
| Build | electron-vite 5 + electron-builder |
| Database | sql.js (pure JS SQLite — no native compilation) |
| IRC | Custom IRCv3 protocol library |
| Testing | Vitest (135 tests across 9 suites) |

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+

### Install & Run

```bash
# Install dependencies
npm install

# Start in development mode (with hot reload)
npm run dev
```

### Build

```bash
# Build for current platform
npm run build

# Build for specific platforms
npm run build:linux
npm run build:mac
npm run build:win
```

### Test

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Project Structure

```
src/
├── main/                  # Electron main process
│   ├── irc/               # IRC protocol engine
│   │   ├── parser.ts      # IRCv3 message parser
│   │   ├── serializer.ts  # Message serializer
│   │   ├── connection.ts  # TCP/TLS socket management
│   │   ├── state.ts       # Connection state tracking
│   │   ├── client.ts      # High-level IRC client API
│   │   ├── manager.ts     # Multi-server manager
│   │   ├── capability.ts  # CAP negotiation
│   │   ├── sasl.ts        # SASL authentication
│   │   ├── scram.ts       # SCRAM-SHA-256 implementation
│   │   ├── handlers/      # IRC command handlers
│   │   └── features/      # IRCv3 extension handlers
│   ├── storage/           # SQLite persistence layer
│   └── ipc/               # IPC bridge (main ↔ renderer)
├── preload/               # Electron preload (contextBridge)
├── renderer/              # React UI
│   ├── components/        # UI components
│   │   ├── layout/        # AppLayout, ServerRail, ChannelSidebar, ChatArea, UserList, TitleBar
│   │   ├── chat/          # MessageItem, MessageContent, MessageComposer, TypingIndicator
│   │   ├── server/        # AddServerModal
│   │   ├── settings/      # SettingsModal
│   │   └── common/        # Modal
│   ├── stores/            # Zustand state (server, channel, message, user, ui)
│   ├── hooks/             # useIRCEvents
│   └── utils/             # IRC formatting parser, URL linkifier
└── shared/                # Shared types and constants
```

## IRCv3 Specification Coverage

### Ratified

| Spec | Status |
|------|--------|
| CAP 302 (capability negotiation) | Implemented |
| SASL 3.2 (PLAIN, EXTERNAL, SCRAM-SHA-256) | Implemented |
| STS (Strict Transport Security) | Implemented |
| message-tags | Implemented |
| batch | Implemented |
| labeled-response | Implemented |
| standard-replies (FAIL/WARN/NOTE) | Implemented |
| echo-message | Implemented |
| server-time | Implemented |
| message-ids (msgid) | Implemented |
| multi-prefix | Implemented |
| userhost-in-names | Implemented |
| extended-join | Implemented |
| account-notify | Implemented |
| account-tag | Implemented |
| away-notify | Implemented |
| chghost | Implemented |
| setname | Implemented |
| monitor | Implemented |
| invite-notify | Implemented |

### Draft

| Spec | Status |
|------|--------|
| +typing (typing indicators) | Implemented |
| +draft/react (reactions) | Implemented |
| draft/chathistory | Implemented |
| draft/read-marker | Implemented |
| draft/message-redaction | Implemented |
| draft/channel-rename | Implemented |
| bot-mode | Implemented |
| WHOX | Implemented |
| draft/multiline | Planned |
| draft/account-registration | Planned |

## Architecture

```
┌─────────────┐     IPC      ┌──────────────┐
│  Renderer    │◄────────────►│    Main       │
│  (React)     │  (typed)     │  (Node.js)   │
│              │              │              │
│  Zustand ────┤              ├── IRCClient  │
│  stores      │              │   ├── parser │
│              │              │   ├── state  │
│  Components  │              │   └── conn   │
│  ├── Layout  │              │              │
│  ├── Chat    │              ├── Storage    │
│  └── Server  │              │   └── sql.js │
└─────────────┘              └──────────────┘
```

**Data flow:** IRC server → socket → parser → handler → state update → IPC emit → Zustand store → React re-render

## Development

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Code formatting
npm run format
```

## License

MIT
