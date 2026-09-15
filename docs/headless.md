# Switchboard without a screen

Switchboard's desktop already does everything a bouncer does — holds the
connections, keeps the history, serves the phone — except stay on. A laptop
closes. This is the same engine with no window, meant for a machine that
doesn't: a VPS, a home server, a Raspberry Pi in a cupboard.

Once it is running, your desktop and phone stop being two clients that take
turns on a network. They become two views of one connection that is always
there. One nick, held continuously, because the machine holding it never
leaves.

## Building it

```
npm ci
npm run build:headless
```

That writes `out-headless/switchboard-headless.cjs`, a single file Node 20 or
later runs directly. Two native modules stay outside it and have to be beside
it, so copy `node_modules` along with the bundle, or run `npm ci --omit=dev` on
the server.

## Running it

```
SWITCHBOARD_PASSPHRASE=… node switchboard-headless.cjs
```

It prints where it put its data, whether the shared config opened, and a
pairing ticket if no device is paired yet.

At a terminal it takes a few commands:

|                                   |                                              |
| --------------------------------- | -------------------------------------------- |
| `status`                          | what it is connected to, and who is attached |
| `networks`                        | the networks it holds, with their ids        |
| `add <name> <host[:port]> <nick>` | add one. `+6697` or a bare `6697` means TLS  |
| `remove <id>`                     | take one away                                |
| `pair`                            | a fresh pairing ticket and code              |
| `devices`                         | phones and desktops paired to it             |
| `clients`                         | IRC clients attached right now               |

You will usually only need `add` once. After that a paired phone or desktop
carries the configuration in the vault, and an attached client can manage
networks over `soju.im/bouncer-networks`.

## Attaching a client

It listens on `127.0.0.1:6667` by default and speaks ordinary IRC, so irssi,
WeeChat, Halloy, Textual and Switchboard itself all attach without knowing
anything about it. Reach it the way you reach anything else on a server:

```
ssh -L 6667:localhost:6667 you@your-server
```

Then point a client at `localhost:6667`, with your username set to the network
you want:

```
/connect localhost 6667
/quote USER kara@laptop/netslum 0 * :Kara
```

Most clients have a field for this. The shape is `user@client/network`:

- `kara` — the bouncer itself, no network
- `kara/netslum` — netslum
- `kara@laptop/netslum` — netslum, from a client calling itself `laptop`

The client name is worth setting. Two clients under one name share a read
marker and a backlog position, so a phone and a laptop that both call
themselves `kara` will each mark the other's messages read.

If there is exactly one network, a client that names none gets it.

You arrive already joined to your channels, under your nick, with the last of
what was said while you were away.

## Settings

All of these are environment variables, read at startup.

|                                        |                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `SWITCHBOARD_DATA`                     | where to keep everything. Defaults to `$XDG_DATA_HOME/switchboard`                                  |
| `SWITCHBOARD_PASSPHRASE`               | opens the shared config. Only needed the first time, or if the key file is lost                     |
| `SWITCHBOARD_PASSPHRASE_FILE`          | the same, read from a file — an environment variable is visible in `ps` to every account on the box |
| `SWITCHBOARD_BOUNCER_PORT`             | the IRC port. `0` turns it off                                                                      |
| `SWITCHBOARD_BOUNCER_BIND`             | what to listen on. Loopback unless you change it                                                    |
| `SWITCHBOARD_BOUNCER_PASS`             | required to bind anything but loopback                                                              |
| `SWITCHBOARD_BOUNCER_TLS_CERT`, `_KEY` | a certificate and key, for a port you expose                                                        |

### Away while nobody is reading

A bouncer stays on the network whether or not anybody is looking at it, which
is the point and also the problem: to everybody else you are present and simply
not answering. So after five minutes with nothing attached — no IRC client on
the port, no paired device on the link — it goes away, and comes back the
moment something attaches.

It says "Not reading right now — messages will be waiting", which is the useful
thing for somebody to know before deciding whether to send one. An away you set
yourself is never touched. Change the delay with the `bouncerAwayMinutes`
setting, or set it to 0 to switch the behaviour off; `bouncerAwayMessage` says
what it says instead.

Going away waits for a timer, because it is a decision about minutes. Coming
back does not: attaching clears it at once, since half a minute listed as away
while sitting in the channel is exactly the window in which somebody gives up
and messages you instead.

### Scrollback

Attaching replays the last of each conversation, and `CHATHISTORY` pages
further back. Where a network keeps its own history the request goes there
instead, because its copy goes back further than ours. Where it does not — most
networks — this is the whole reason to run a bouncer, and the scrollback exists
because it was connected when you were not.

### About binding off loopback

On `127.0.0.1` the operating system has already decided who may connect, and
anybody who got there over SSH authenticated once already. On any other address
the port is reachable by whoever can route to it, and an open one hands out a
logged-in session on every network in the vault — so a password is required
there and there is no flag to skip it.

Expose it with TLS or don't expose it. IRC sends your password in the clear.

## As a service

```ini
[Unit]
Description=Switchboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/node /opt/switchboard/switchboard-headless.cjs
WorkingDirectory=/opt/switchboard
Environment=SWITCHBOARD_DATA=/var/lib/switchboard
Environment=SWITCHBOARD_PASSPHRASE_FILE=/etc/switchboard/passphrase
Restart=always
RestartSec=10
User=switchboard

# It needs its own data and nothing else
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
NoNewPrivileges=true
ReadWritePaths=/var/lib/switchboard

[Install]
WantedBy=multi-user.target
```

Run it as its own user. `journalctl -u switchboard -f` shows what the
connections are doing.

## What carries over the IRC port

Everything the network agreed to send. The bouncer offers an attached client
every capability it negotiated upstream, minus the five that describe its own
socket rather than what the network sends — so typing notifications,
reactions, replies, edits, redactions, profiles, away-notify, account tags and
the rest all arrive.

Reactions and replies in particular are client tags on a `TAGMSG`, and they
carry the network's own message id, which is what a reply, a reaction and a
redaction are addressed to. Two clients attached at once each see what the
other says, exactly once.

The five kept back: `sasl`, because logging in to the _network_ is the
bouncer's job and it offers a `sasl` of its own for logging in to the bouncer;
`draft/webpush`, because a push subscription belongs to the device that will be
woken by it; `cap-notify`, because nothing here sends `CAP NEW` or `CAP DEL`
and a promise not kept is worse than a capability not offered; and
`draft/pre-away` and `draft/auto-join`, which only do anything during
registration.

Going the other way, a line from a client is sanitised: the prefix comes off,
because clients do not send one, and so do `msgid`, `time` and `account`, which
are the network's to assign. Client tags and `label` stay, being exactly what a
client is meant to set.

## Linking it to your desktop and phone

The IRC port is one of two ways in, and the other one is what makes the
hand-over work.

Pair the desktop and the phone to the always-on instance the same way you pair
them to each other. The desktop can go looking for it — Settings → Devices →
Always-on Switchboard, paste the ticket and the code — or the instance can go
looking for the desktop, with `dial <ticket> <code>` at its console. Either
direction works; whichever end has the other's ticket is the one that moves.
The code is needed once. After that each recognises the other by its key and
finds it again on every restart with nobody involved.

Once they are linked, the always-on instance holds the connections and the
others follow. If it stops, the desktop notices within about twenty seconds,
opens the shared config and takes over; the phone keeps following the desktop.
If the desktop stops too, the phone takes over. When the always-on instance
comes back it takes the connections again and everything follows it. None of
that needs anybody to do anything.

You do not have to pair all three to each other. A phone paired to the desktop
and a desktop paired to the always-on instance is enough: a device that cannot
see who is holding the network is told by the one that can.

### One shared config, made once

A config's key comes from your passphrase _and_ a salt made when the config was
made, so two configs created separately under the same passphrase cannot open
each other. Make one, on whichever device you set up first, and let the others
adopt it.

That is why a headless instance never makes one on its own. Give it
`SWITCHBOARD_PASSPHRASE` and it opens whatever arrives; `vault create` at the
console makes the first one, for somebody whose server really is the first
thing they set up.

If you do end up with two, the way out is to lock the one you want to replace
and unlock it again once the other's has arrived.

## How it decides who holds the network

Every Switchboard advertises how good a host it is: a headless instance
outranks a desktop, which outranks a phone. The best one present holds the
connections and the rest follow it, and when it goes the next one takes over.

A headless instance outranks everything and never leaves, so in practice
nothing hands over at all. That is what keeps the nick: every hand-over is a
moment on the network where you are briefly gone, and there are none.

When a device attaches through the IRC port instead, none of that applies — a
bouncer is built to multiplex, so every device stays on at once. Switchboard
recognises a bouncer from what it says about itself (`BOUNCER` in ISUPPORT, or
the `soju.im/bouncer-networks` capability) and turns the arbitration off for
that network.

A device that is following does not dial the network at all, including while it
is still working out whether it should be. That is deliberate: a desktop that
connected first and handed over afterwards would appear in your channels as
`nick___` for a few seconds, every time it started.

## Where the secrets are

The desktop keeps its database key in the OS keychain. There is no keychain on
a server and no session to unlock one, so this keeps a key file beside the data
instead, readable only by the account it runs as.

That is weaker, and worth stating plainly: a keychain is locked when the
session is; this is readable by anything running as this user the moment the
machine is on. What it still buys is real — the database and the saved
passwords are not readable from a stolen disk, a backup, or a copied volume.

Back up `headless.key` with the data. Without it the data is gone.

## Running it against someone else's bouncer instead

None of this is required. If you already run soju, add it to Switchboard as a
network like any other: Switchboard speaks `soju.im/bouncer-networks` as a
client too, so it sees every network soju holds through one connection, and
both devices stay attached at once.

The headless build is for people who would rather not run two things.
