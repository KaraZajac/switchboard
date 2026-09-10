import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../common/Modal'
import { useUIStore } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'
import { accountAbilities, bestSaslMechanism } from '@shared/accounts'

/**
 * Your account on one network.
 *
 * IRC's identity model is two things wearing one coat: the nick is what you are
 * called this minute, the account is what the network agrees you own. Almost
 * everything people ask NickServ is really a question about the second one, and
 * the desktop could neither show it nor change it — there was no way to
 * register, no way to log in, and no way to find out whether you were logged in
 * at all. The phone grew this screen first; this is the same one.
 *
 * Which half you get depends on what the network can do:
 *
 * - `draft/account-registration` and the whole thing happens in the client,
 *   with the password saved as SASL so every later connection logs in before it
 *   is even on the network.
 * - Everywhere else, NickServ. Same two boxes, but the client knows the phrase
 *   and saves it as the network's identify command.
 *
 * The saved password matters for a second reason on top of convenience: a
 * server will only let two devices on under one nick when both have
 * authenticated to the same account.
 */
export function AccountModal() {
  const closeModal = useUIStore((s) => s.closeModal)
  const serverId = useUIStore((s) => s.accountServerId)

  const servers = useServerStore((s) => s.servers)
  const nick = useServerStore((s) => (serverId ? s.currentNick[serverId] : '') ?? '')
  const account = useServerStore((s) => (serverId ? s.account[serverId] : null) ?? null)
  const status = useServerStore((s) => (serverId ? s.connectionStatus[serverId] : undefined))
  const values = useServerStore((s) => (serverId ? s.capabilityValues[serverId] : undefined))

  const server = servers.find((s) => s.id === serverId)
  const abilities = useMemo(() => accountAbilities(values ?? {}), [values])

  const [name, setName] = useState(nick)
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ text: string; failed: boolean } | null>(null)
  const [awaitingCode, setAwaitingCode] = useState(false)

  useEffect(() => setName(nick), [nick])

  // The network's answer to REGISTER or VERIFY arrives whenever it arrives.
  useEffect(() => {
    const api = window.switchboard
    if (!api || !serverId) return

    const cleanups = [
      api.on('irc:account-registered', (event) => {
        if (event.serverId !== serverId) return
        setBusy(false)
        setAwaitingCode(event.status === 'VERIFICATION_REQUIRED')
        setOutcome({ text: event.message, failed: false })
      }),
      api.on('irc:verify', (event) => {
        if (event.serverId !== serverId) return
        setBusy(false)
        setAwaitingCode(false)
        setOutcome({ text: event.message, failed: false })
      }),
      api.on('irc:error', (event) => {
        if (event.serverId !== serverId) return
        if (event.command !== 'REGISTER' && event.command !== 'VERIFY') return
        setBusy(false)
        setOutcome({ text: event.message, failed: true })
      })
    ]
    return () => cleanups.forEach((off) => off())
  }, [serverId])

  if (!serverId || !server) return null

  const alreadyRemembered = !!server.saslPassword || !!server.identifyCommand

  /**
   * Remember the account so the next connection logs in by itself.
   *
   * SASL wherever the network offers it: it happens before registration
   * completes, so nothing is said or joined under the wrong identity, and there
   * is no window where the nick is unprotected. Where it does not, the same
   * credentials become the identify command instead.
   */
  const remember = async (who: string, secret: string): Promise<void> => {
    const mechanism = bestSaslMechanism(abilities.saslMechanisms)
    if (mechanism) {
      await window.switchboard.invoke('server:update', serverId, {
        saslMechanism: mechanism,
        saslUsername: who,
        saslPassword: secret
      })
    } else {
      await window.switchboard.invoke('server:update', serverId, {
        identifyCommand: `PRIVMSG NickServ :IDENTIFY ${who} ${secret}`
      })
    }
  }

  const register = async (): Promise<void> => {
    setBusy(true)
    setOutcome(null)
    // Saved first: the reply comes back over the same connection, and a client
    // that loses the window in between should still be able to log in.
    await remember(name, password)
    await window.switchboard.invoke('account:register', serverId, email || null, password)
  }

  const verify = async (): Promise<void> => {
    setBusy(true)
    await window.switchboard.invoke('account:verify', serverId, name, code)
  }

  const identify = async (): Promise<void> => {
    setBusy(true)
    await remember(name, password)
    await window.switchboard.invoke(
      'message:send',
      serverId,
      'NickServ',
      `IDENTIFY ${name} ${password}`
    )
    setPassword('')
    setBusy(false)
    setOutcome({ text: 'Sent. NickServ will answer in a moment.', failed: false })
  }

  const connected = status === 'connected'
  const longEnough = password.length >= (abilities.minPasswordLength ?? 1)

  return (
    <Modal title="Account" onClose={closeModal}>
      <div className="space-y-4">
        <Standing nick={nick} account={account} connected={connected} />

        {!connected && (
          <Explain>
            Connect to this network first. What it can do about accounts is
            something it tells us when we get there.
          </Explain>
        )}

        {connected && account && (
          <>
            {alreadyRemembered ? (
              <Explain>
                This network logs you in as {account} on its own, before anything is
                said or joined under the wrong name.
              </Explain>
            ) : (
              <>
                <Explain>
                  You are logged in as {account}, but only for now — the next
                  connection will start out as nobody.
                </Explain>
                <Field
                  label="Password"
                  hint="To log in automatically next time"
                  value={password}
                  secret
                  onChange={setPassword}
                />
                <Action
                  label="Remember this account"
                  disabled={!password || busy}
                  onClick={async () => {
                    await remember(account, password)
                    setPassword('')
                    setOutcome({
                      text: 'Saved. This network will log you in on its own from now on.',
                      failed: false
                    })
                  }}
                />
              </>
            )}
          </>
        )}

        {connected && !account && abilities.canRegister && (
          <>
            {awaitingCode ? (
              <>
                <Explain>Check your email for a code and put it in below.</Explain>
                <Field label="Code" hint="From the email" value={code} onChange={setCode} />
                <Action label="Finish" disabled={!code || busy} onClick={verify} />
              </>
            ) : (
              <>
                <Explain>
                  This network can register your nick for you. Choose a password and
                  it is yours.
                </Explain>
                <Field label="Nick to register" hint="" value={name} onChange={setName} />
                <Field
                  label="Password"
                  hint={
                    abilities.minPasswordLength
                      ? `At least ${abilities.minPasswordLength} characters`
                      : 'Pick something new'
                  }
                  value={password}
                  secret
                  onChange={setPassword}
                />
                {abilities.emailRequired && (
                  <Field
                    label="Email"
                    hint="This network needs one"
                    value={email}
                    onChange={setEmail}
                  />
                )}
                <Action
                  label={`Register ${name}`}
                  disabled={busy || !longEnough || (abilities.emailRequired && !email)}
                  onClick={register}
                />
              </>
            )}
          </>
        )}

        {connected && !account && !abilities.canRegister && (
          <>
            <Explain>
              This network uses NickServ. Log in here and it will be done for you
              every time you connect.
            </Explain>
            <Field label="Account" hint="Usually your nick" value={name} onChange={setName} />
            <Field label="Password" hint="" value={password} secret onChange={setPassword} />
            <Action
              label="Log in to NickServ"
              disabled={!name || !password || busy}
              onClick={identify}
            />
            <Explain>
              No account yet? Send NickServ a message saying REGISTER &lt;password&gt;
              &lt;email&gt;.
            </Explain>
          </>
        )}

        {outcome && (
          <div
            className={`rounded p-3 text-sm ${
              outcome.failed ? 'bg-red-500/10 text-red-300' : 'bg-emerald-500/10 text-emerald-300'
            }`}
          >
            {outcome.text}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** Who the network currently thinks you are */
function Standing({
  nick,
  account,
  connected
}: {
  nick: string
  account: string | null
  connected: boolean
}) {
  const colour = account ? 'bg-emerald-400' : connected ? 'bg-amber-400' : 'bg-gray-500'
  return (
    <div className="flex items-center gap-3">
      <span className={`h-2.5 w-2.5 rounded-full ${colour}`} />
      <div>
        <div className="font-semibold text-gray-100">{nick || 'Not connected'}</div>
        <div className={`text-xs ${account ? 'text-emerald-400' : 'text-gray-400'}`}>
          {account
            ? `Logged in as ${account}`
            : connected
              ? 'Not logged in — this nick is not protected'
              : 'Offline'}
        </div>
      </div>
    </div>
  )
}

function Explain({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-gray-400">{children}</p>
}

function Field({
  label,
  hint,
  value,
  secret,
  onChange
}: {
  label: string
  hint: string
  value: string
  secret?: boolean
  onChange: (next: string) => void
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </label>
      <input
        type={secret ? 'password' : 'text'}
        value={value}
        placeholder={hint}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded bg-gray-900 px-3 py-2 text-sm text-gray-100 ring-1 ring-gray-700 focus:outline-none focus:ring-indigo-500"
      />
    </div>
  )
}

function Action({
  label,
  disabled,
  onClick
}: {
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500"
    >
      {label}
    </button>
  )
}
