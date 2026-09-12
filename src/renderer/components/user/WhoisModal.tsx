import { Modal } from '../common/Modal'
import { useUIStore } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'
import { displayNameFor, metadataColor } from '@shared/types/metadata'
import { avatarUrl as safeAvatarUrl } from '@shared/avatar'
import { safeExternalUrl } from '@shared/links'
import { nickColor } from '../../utils/nickColor'

export function WhoisModal() {
  const closeModal = useUIStore((s) => s.closeModal)
  const data = useUIStore((s) => s.whoisData)
  const activeServerId = useServerStore((s) => s.activeServerId)
  const userMetadata = useServerStore((s) => s.userMetadata)

  if (!data) return null

  /**
   * Who they say they are, where the network carries it.
   *
   * `draft/metadata-2` is how somebody puts a name, pronouns, a picture and a
   * line about themselves against their nick, and this client has subscribed
   * to it since it supported the capability — it simply never showed any of it
   * when you clicked a person. The phone has shown it all along, so the same
   * click gave you a profile on one client and a table of hostnames on the
   * other.
   *
   * Empty on a network without metadata, which is most of IRC, and then this
   * is the WHOIS it always was.
   */
  const profile = activeServerId
    ? (userMetadata[`${activeServerId}:${data.nick.toLowerCase()}`] ?? {})
    : {}

  const shownName = displayNameFor(data.nick, profile)
  const colour = metadataColor(profile.color) ?? nickColor(data.nick)
  const avatar = safeAvatarUrl(profile.avatar)
  const pronouns = profile.pronouns?.trim()
  const status = profile.status?.trim()
  // A homepage is a metadata key, which means a stranger chose the string.
  // Shown as text either way; only a link we would actually open is a link.
  const homepage = profile.homepage?.trim()
  const homepageLink = safeExternalUrl(homepage)

  const fields: { label: string; value: string | undefined }[] = [
    { label: 'Nickname', value: data.nick },
    { label: 'Username', value: data.user },
    { label: 'Hostname', value: data.host },
    { label: 'Real Name', value: data.realname },
    { label: 'Account', value: data.account },
    {
      label: 'Server',
      value: data.server
        ? `${data.server}${data.serverInfo ? ` (${data.serverInfo})` : ''}`
        : undefined
    },
    { label: 'Channels', value: data.channels },
    { label: 'Idle', value: data.idle ? formatIdle(parseInt(data.idle)) : undefined },
    {
      label: 'Sign-on',
      value: data.signon ? new Date(parseInt(data.signon) * 1000).toLocaleString() : undefined
    }
  ]

  return (
    <Modal title={`User Info — ${data.nick}`} onClose={closeModal}>
      <div className="space-y-3">
        {/* Avatar and badges */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full text-2xl font-bold text-gray-900"
            style={{ backgroundColor: colour }}
          >
            {avatar ? (
              <img src={avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              shownName.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-lg font-semibold text-gray-100">{shownName}</span>
              {pronouns && (
                <span className="shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-xs font-semibold text-gray-300">
                  {pronouns}
                </span>
              )}
            </div>
            {/* The nick underneath, because a display name is not an identity:
                the thing you type at is still the nick. */}
            {shownName !== data.nick && (
              <div className="truncate text-sm text-gray-400">{data.nick}</div>
            )}
            <div className="flex gap-2">
              {data.isOperator && (
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-semibold text-amber-400">
                  IRC Operator
                </span>
              )}
              {data.isBot && (
                <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-xs font-semibold text-indigo-400">
                  Bot
                </span>
              )}
            </div>
          </div>
        </div>

        {(status || homepage) && (
          <div className="space-y-2 rounded bg-gray-900 p-3">
            {status && <div className="text-sm text-gray-200">{status}</div>}
            {homepage &&
              (homepageLink ? (
                <a
                  href={homepageLink}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm text-indigo-400 hover:underline"
                >
                  {homepage}
                </a>
              ) : (
                <div className="block truncate text-sm text-gray-400">{homepage}</div>
              ))}
          </div>
        )}

        {/* Fields */}
        <div className="space-y-2 rounded bg-gray-900 p-3">
          {fields
            .filter((f) => f.value)
            .map((f) => (
              <div key={f.label} className="flex items-start gap-3">
                <span className="w-24 flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {f.label}
                </span>
                <span className="break-all text-sm text-gray-200">{f.value}</span>
              </div>
            ))}
        </div>
      </div>
    </Modal>
  )
}

function formatIdle(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}
