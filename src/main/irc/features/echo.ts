/**
 * echo-message — Delivery confirmation for our own messages.
 *
 * When echo-message is enabled, the server echoes our PRIVMSG/NOTICE
 * back to us. We should NOT display the message when we send it —
 * instead wait for the echo.
 *
 * The actual handling happens in the message handler (handlers/message.ts)
 * via the isEcho detection. The renderer uses the `pending` flag on
 * ChatMessage to show/hide messages before echo confirmation.
 *
 * This module provides helpers for echo-message awareness.
 */

/**
 * Check if echo-message is enabled for a connection.
 */
export function hasEchoMessage(capabilities: Set<string>): boolean {
  return capabilities.has('echo-message')
}
