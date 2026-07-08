package cr.marin.shellkeep.net.dto

import cr.marin.shellkeep.terminal.KeyShortcut
import kotlinx.serialization.Serializable

@Serializable
data class UserSettingsDto(
    val theme: String = "system", // "light" | "dark" | "system"
    val profile: ProfileSettings = ProfileSettings(),
    val terminal: TerminalSettings? = null,
    val updatedAt: String? = null,
    val version: Int = 0,
)

@Serializable
data class ProfileSettings(
    val displayName: String? = null,
    val useProviderImage: Boolean = true,
    val customImageUrl: String? = null,
)

@Serializable
data class TerminalSettings(
    val showScrollButtons: Boolean = true,
    val keyShortcuts: List<KeyShortcut>? = null,
    val fontSize: Int? = null,
)
