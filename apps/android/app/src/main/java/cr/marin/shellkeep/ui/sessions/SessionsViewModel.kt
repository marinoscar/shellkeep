package cr.marin.shellkeep.ui.sessions

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import cr.marin.shellkeep.net.ApiClient
import cr.marin.shellkeep.net.ApiService
import cr.marin.shellkeep.net.dto.CreateSessionRequest
import cr.marin.shellkeep.net.dto.ServerProfileDto
import cr.marin.shellkeep.net.dto.TerminalSessionDto
import cr.marin.shellkeep.net.dto.UpdateSessionRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class SessionsViewModel(app: Application) : AndroidViewModel(app) {

    private val service: ApiService = ApiClient.get(app).service

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    init { refresh() }

    fun refresh() {
        _state.update { it.copy(isLoading = true, error = null) }
        viewModelScope.launch {
            try {
                val page = service.listSessions(page = 1, pageSize = 100, status = "all")
                _state.update {
                    it.copy(isLoading = false, sessions = page.items, error = null)
                }
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Throwable) {
                _state.update {
                    it.copy(isLoading = false, error = t.message ?: t.javaClass.simpleName)
                }
            }
        }
    }

    fun setStatusFilter(filter: StatusFilter) {
        _state.update { it.copy(filter = filter) }
    }

    /** Lazy-loads server-profiles for the new-session dialog. */
    fun loadServerProfiles() {
        if (_state.value.serverProfiles.isNotEmpty() || _state.value.profilesLoading) return
        _state.update { it.copy(profilesLoading = true) }
        viewModelScope.launch {
            try {
                val page = service.listServerProfiles(page = 1, pageSize = 100)
                _state.update {
                    it.copy(profilesLoading = false, serverProfiles = page.items)
                }
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Throwable) {
                _state.update {
                    it.copy(
                        profilesLoading = false,
                        error = t.message ?: "Failed to load server profiles",
                    )
                }
            }
        }
    }

    fun createSession(serverProfileId: String, name: String?, onCreated: (TerminalSessionDto) -> Unit) {
        viewModelScope.launch {
            try {
                val created = service.createSession(
                    CreateSessionRequest(serverProfileId = serverProfileId, name = name?.ifBlank { null })
                )
                _state.update { it.copy(sessions = listOf(created) + it.sessions) }
                onCreated(created)
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Throwable) {
                _state.update { it.copy(error = t.message ?: "Failed to create session") }
            }
        }
    }

    fun rename(id: String, name: String) {
        viewModelScope.launch {
            try {
                val updated = service.renameSession(id, UpdateSessionRequest(name))
                _state.update { st ->
                    st.copy(sessions = st.sessions.map { if (it.id == id) updated else it })
                }
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Throwable) {
                _state.update { it.copy(error = t.message ?: "Rename failed") }
            }
        }
    }

    fun delete(id: String) {
        viewModelScope.launch {
            try {
                service.deleteSession(id)
                _state.update { st -> st.copy(sessions = st.sessions.filterNot { it.id == id }) }
                ApiClient.get(getApplication()).sessionsManager.close(id)
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Throwable) {
                _state.update { it.copy(error = t.message ?: "Delete failed") }
            }
        }
    }

    fun dismissError() {
        _state.update { it.copy(error = null) }
    }

    enum class StatusFilter(val wire: String, val label: String) {
        ALL("all", "All"),
        ACTIVE("active", "Active"),
        DETACHED("detached", "Detached"),
        TERMINATED("terminated", "Terminated"),
    }

    data class UiState(
        val isLoading: Boolean = false,
        val sessions: List<TerminalSessionDto> = emptyList(),
        val filter: StatusFilter = StatusFilter.ALL,
        val profilesLoading: Boolean = false,
        val serverProfiles: List<ServerProfileDto> = emptyList(),
        val error: String? = null,
    ) {
        val filteredSessions: List<TerminalSessionDto>
            get() = if (filter == StatusFilter.ALL) sessions
            else sessions.filter { it.status == filter.wire }
    }
}
