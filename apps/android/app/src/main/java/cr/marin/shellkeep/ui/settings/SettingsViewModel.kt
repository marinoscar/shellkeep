package cr.marin.shellkeep.ui.settings

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import cr.marin.shellkeep.auth.AuthManager
import cr.marin.shellkeep.net.ApiClient
import cr.marin.shellkeep.net.dto.TerminalSettings
import cr.marin.shellkeep.net.dto.UserSettingsDto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import retrofit2.HttpException

class SettingsViewModel(app: Application) : AndroidViewModel(app) {

    private val service = ApiClient.get(app).service
    private val authManager: AuthManager = ApiClient.get(app).authManager

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        _state.update { it.copy(isLoading = true, error = null) }
        viewModelScope.launch {
            try {
                val settings = service.getUserSettings().data
                _state.update { it.copy(isLoading = false, settings = settings, error = null) }
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Throwable) {
                _state.update { it.copy(isLoading = false, error = t.message ?: t.javaClass.simpleName) }
            }
        }
    }

    fun setTheme(theme: String) = patch { it.copy(theme = theme) }

    fun setShowScrollButtons(value: Boolean) = patch { current ->
        val terminal = current.terminal ?: TerminalSettings()
        current.copy(terminal = terminal.copy(showScrollButtons = value))
    }

    fun setFontSize(value: Int) = patch { current ->
        val terminal = current.terminal ?: TerminalSettings()
        current.copy(terminal = terminal.copy(fontSize = value))
    }

    private fun patch(transform: (UserSettingsDto) -> UserSettingsDto) {
        val current = _state.value.settings ?: return
        val next = transform(current)
        _state.update { it.copy(settings = next, isSaving = true) }
        viewModelScope.launch {
            try {
                val updated = service.patchUserSettings(
                    versionMatch = current.version.toString(),
                    body = next,
                ).data
                _state.update { it.copy(settings = updated, isSaving = false) }
            } catch (ce: CancellationException) {
                throw ce
            } catch (e: HttpException) {
                if (e.code() == 412) {
                    // Version conflict — refresh and let the user re-apply.
                    refresh()
                    _state.update { it.copy(isSaving = false, error = "Settings changed elsewhere; reloaded.") }
                } else {
                    _state.update { it.copy(isSaving = false, error = "Save failed (${e.code()})") }
                }
            } catch (t: Throwable) {
                _state.update { it.copy(isSaving = false, error = t.message ?: "Save failed") }
            }
        }
    }

    fun logout(onDone: () -> Unit) {
        viewModelScope.launch {
            authManager.logout()
            onDone()
        }
    }

    fun dismissError() {
        _state.update { it.copy(error = null) }
    }

    data class UiState(
        val isLoading: Boolean = true,
        val isSaving: Boolean = false,
        val settings: UserSettingsDto? = null,
        val error: String? = null,
    )
}
