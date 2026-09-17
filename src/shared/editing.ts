/**
 * Which of your own messages you can still change.
 *
 * Both clients offer an Edit action and neither asked this properly, so both
 * offered it in two places it does not work:
 *
 *  - **On a server that does not carry edits.** An edit is an ordinary
 *    `PRIVMSG` wearing a `+draft/edit` client tag. A server without the
 *    capability relays it as what it looks like — so "editing" a line on one
 *    of those posts the new text as a *second message* and leaves the first
 *    where it was. Worse than refusing.
 *  - **On an action.** `/me waves` is a `PRIVMSG` with the text wrapped in
 *    CTCP, and the edit sends the box's contents as plain text — so amending
 *    one turned it from something you did into something you said.
 *
 * Shared because the question is the same on both, and because the desktop
 * asks it a third time: the Up key opens the last message you can edit.
 */

/** As much of a message as this question needs */
export interface EditableMessage {
  readonly id: string
  readonly nick: string
  readonly type: string
  readonly deleted?: boolean
}

/**
 * Both spellings.
 *
 * Capabilities lose their `draft/` prefix when they are ratified, and a client
 * that only knows the draft name stops offering the feature on the day the
 * servers stop being drafts — see `isupportValue`, which learned the same
 * lesson about tokens.
 */
const EDIT_CAPS = ['draft/message-edit', 'message-edit']

export function editsAllowed(capabilities: readonly string[]): boolean {
  return capabilities.some((capability) => EDIT_CAPS.includes(capability))
}

/** Whether this message is yours, and of a kind an edit would not spoil */
export function canEdit(
  message: EditableMessage,
  myNick: string,
  capabilities: readonly string[]
): boolean {
  if (!editsAllowed(capabilities)) return false
  // Nothing to amend, and the server would refuse the attempt
  if (message.deleted) return false
  // Plain text only: an action, a notice and a system line each mean something
  // the edit would not carry.
  if (message.type !== 'privmsg') return false
  if (!myNick) return false
  return message.nick.toLowerCase() === myNick.toLowerCase()
}

/**
 * The message the Up key opens for editing, or null if there is none.
 *
 * The most recent one, which is what somebody pressing Up means — the thing
 * they just said and got wrong. Ordered oldest to newest, as a conversation
 * is held everywhere else in this codebase.
 */
export function lastEditable(
  messages: readonly EditableMessage[],
  myNick: string,
  capabilities: readonly string[]
): EditableMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (canEdit(messages[i], myNick, capabilities)) return messages[i]
  }
  return null
}
