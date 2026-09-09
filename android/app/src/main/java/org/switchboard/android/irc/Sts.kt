package org.switchboard.android.irc

import java.time.Instant

/**
 * Strict Transport Security — IRCv3.
 *
 * A server advertising `sts` is telling us it is TLS-only: reconnect on this
 * port, over TLS, and remember that for the stated duration. A client that
 * ignores it keeps offering an attacker a plaintext window — and this is the
 * phone, which is the device most likely to be on somebody else's network.
 *
 * The policy has to outlive the process to be worth anything, so it is written
 * through [Store] rather than kept only in memory.
 */
data class StsPolicy(
    val host: String,
    val port: Int,
    val durationSeconds: Long,
    val cachedAt: Instant
) {
    fun expiredAt(now: Instant): Boolean =
        now.isAfter(cachedAt.plusSeconds(durationSeconds))
}

object Sts {

    /** Where policies live between runs */
    interface Store {
        fun load(): List<StsPolicy>
        fun save(policy: StsPolicy)
        fun forget(host: String)
    }

    private val policies = mutableMapOf<String, StsPolicy>()
    private var store: Store? = null

    @Synchronized
    fun useStore(backing: Store) {
        store = backing
        policies.clear()
        for (policy in backing.load()) policies[policy.host.lowercase()] = policy
    }

    /**
     * Parse the capability's value: `port=6697,duration=2592000`.
     *
     * Anything without both parts is not a policy, and guessing at a partial
     * one would mean redirecting a connection on the strength of a typo.
     */
    fun parse(value: String?): Pair<Int, Long>? {
        if (value.isNullOrBlank()) return null
        val parts = value.split(",").mapNotNull {
            val at = it.indexOf('=')
            if (at < 0) null else it.substring(0, at) to it.substring(at + 1)
        }.toMap()

        val port = parts["port"]?.toIntOrNull() ?: return null
        val duration = parts["duration"]?.toLongOrNull() ?: return null
        if (port !in 1..65535 || duration < 0) return null
        return port to duration
    }

    /** Record what a server has told us, or drop it when duration is zero */
    @Synchronized
    fun remember(host: String, port: Int, durationSeconds: Long) {
        // A hostname, not an IRC name: DNS folds ASCII case and nothing else,
        // so `lowercase` is right here and `casemap` would be wrong.
        val key = host.lowercase()
        if (durationSeconds == 0L) {
            policies.remove(key)
            store?.forget(key)
            return
        }
        val policy = StsPolicy(key, port, durationSeconds, Instant.now())
        policies[key] = policy
        store?.save(policy)
    }

    /** The live policy for a host, forgetting it once it has expired */
    @Synchronized
    fun policyFor(host: String, now: Instant = Instant.now()): StsPolicy? {
        val key = host.lowercase()
        val policy = policies[key] ?: return null
        if (policy.expiredAt(now)) {
            policies.remove(key)
            store?.forget(key)
            return null
        }
        return policy
    }

    /**
     * Where this server must actually be reached.
     *
     * Null when the settings already satisfy the policy, or when there is none.
     */
    @Synchronized
    fun upgradeFor(host: String, port: Int, tls: Boolean): Pair<Int, Boolean>? {
        val policy = policyFor(host) ?: return null
        if (tls && port == policy.port) return null
        return policy.port to true
    }

    /** For tests, and for a device being unpaired */
    @Synchronized
    fun forgetEverything() {
        policies.clear()
        store = null
    }
}
