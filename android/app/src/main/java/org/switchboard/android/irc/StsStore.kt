package org.switchboard.android.irc

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/**
 * STS policies, kept on the phone.
 *
 * Shared preferences rather than the vault: this is not a secret and not shared
 * config — it is one device's memory of what a server told it, and it has to be
 * there before anything is unlocked, because the first connection after a
 * restart is exactly the one an attacker would want in the clear.
 */
class StsStore(context: Context) : Sts.Store {

    private val prefs = context.getSharedPreferences("switchboard-sts", Context.MODE_PRIVATE)

    override fun load(): List<StsPolicy> {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            (0 until array.length()).map { index ->
                val entry = array.getJSONObject(index)
                StsPolicy(
                    host = entry.getString("host"),
                    port = entry.getInt("port"),
                    durationSeconds = entry.getLong("duration"),
                    cachedAt = Instant.parse(entry.getString("cachedAt"))
                )
            }
        }.getOrDefault(emptyList())
    }

    override fun save(policy: StsPolicy) {
        val kept = load().filterNot { it.host.equals(policy.host, ignoreCase = true) } + policy
        write(kept)
    }

    override fun forget(host: String) {
        write(load().filterNot { it.host.equals(host, ignoreCase = true) })
    }

    private fun write(policies: List<StsPolicy>) {
        val array = JSONArray()
        for (policy in policies) {
            array.put(
                JSONObject()
                    .put("host", policy.host)
                    .put("port", policy.port)
                    .put("duration", policy.durationSeconds)
                    .put("cachedAt", policy.cachedAt.toString())
            )
        }
        prefs.edit().putString(KEY, array.toString()).apply()
    }

    private companion object {
        const val KEY = "policies"
    }
}
