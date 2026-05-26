package cr.marin.shellkeep.ui.pairing

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import cr.marin.shellkeep.auth.AuthManager
import cr.marin.shellkeep.net.ApiClient
import cr.marin.shellkeep.net.dto.DeviceCodeResponse
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Owns the device-authorization flow on the UI side. Calls into [AuthManager],
 * surfaces a single [UiState] for the Compose layer to render. Polling job is
 * cancelled on cleanup so a Back-press in the middle of pairing doesn't leak.
 */
class PairingViewModel(app: Application) : AndroidViewModel(app) {

    private val authManager: AuthManager = ApiClient.get(app).authManager

    private val _state = MutableStateFlow<UiState>(UiState.Idle)
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var pollJob: Job? = null

    init {
        startFlow()
    }

    fun retry() = startFlow()

    private fun startFlow() {
        pollJob?.cancel()
        _state.value = UiState.Loading
        pollJob = viewModelScope.launch {
            try {
                val code = authManager.startDeviceFlow()
                _state.value = UiState.AwaitingApproval(code)
                authManager.pollForToken(
                    deviceCode = code.deviceCode,
                    intervalSec = code.interval,
                    expiresInSec = code.expiresIn,
                )
                _state.value = UiState.Success
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Throwable) {
                _state.value = UiState.Failed(
                    message = t.message ?: t.javaClass.simpleName,
                    isFatal = t is AuthManager.DeviceAccessDenied,
                )
            }
        }
    }

    override fun onCleared() {
        pollJob?.cancel()
        super.onCleared()
    }

    sealed interface UiState {
        data object Idle : UiState
        data object Loading : UiState
        data class AwaitingApproval(val code: DeviceCodeResponse) : UiState
        data object Success : UiState
        data class Failed(val message: String, val isFatal: Boolean) : UiState
    }
}
