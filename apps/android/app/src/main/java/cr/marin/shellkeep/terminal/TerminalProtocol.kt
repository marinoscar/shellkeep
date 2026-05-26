package cr.marin.shellkeep.terminal

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Wire envelopes the Android client sends to the server. Matches the JSON
 * shapes expected by `apps/api/src/terminal/terminal.gateway.ts`. Server
 * dispatches on the `type` field; we serialize that as the polymorphic
 * discriminator (kotlinx-serialization default class discriminator is "type").
 */
@Serializable
sealed class ControlOut {
    @Serializable @SerialName("auth") data class Auth(val token: String) : ControlOut()
    @Serializable @SerialName("connect") data class Connect(val sessionId: String) : ControlOut()
    @Serializable @SerialName("resize") data class Resize(val cols: Int, val rows: Int) : ControlOut()
    @Serializable @SerialName("ping") data object Ping : ControlOut()
}

/**
 * Known server→client control message types. Forward-compatible: unknown
 * `type` values are ignored. Server may also send arbitrary binary frames
 * (terminal output) which are handled outside this enum.
 */
enum class ControlIn(val wire: String) {
    AUTH_OK("auth_ok"),
    AUTH_FAIL("auth_fail"),
    SESSION_READY("session_ready"),
    SESSION_ERROR("session_error"),
    SESSION_ENDED("session_ended"),
    PONG("pong");

    companion object {
        fun fromWire(value: String?): ControlIn? = entries.firstOrNull { it.wire == value }
    }
}
