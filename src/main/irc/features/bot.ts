/**
 * bot-mode — Identify bots in the user list.
 *
 * The BOT ISUPPORT token defines the mode character.
 * RPL_WHOISBOT (335) is sent during WHOIS.
 * Messages from bots include a `bot` tag.
 *
 * We handle bot identification in the WHO/WHOIS responses
 * and through the account-tag on messages.
 */

// RPL_WHOISBOT is already handled in handlers/user.ts (335)

// Bot detection from WHO flags is handled in whox.ts
