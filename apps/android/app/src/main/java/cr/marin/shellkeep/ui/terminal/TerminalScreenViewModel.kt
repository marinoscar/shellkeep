package cr.marin.shellkeep.ui.terminal

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import cr.marin.shellkeep.net.ApiClient
import cr.marin.shellkeep.net.dto.TerminalSessionDto
import cr.marin.shellkeep.terminal.SessionsManager
import cr.marin.shellkeep.terminal.TerminalBuffer
import cr.marin.shellkeep.terminal.TerminalConnection
import cr.marin.shellkeep.terminal.TerminalService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Owns the Pager state for the multi-session terminal screen. Each open tab
 * has an entry in [tabs] that pairs a [TerminalConnection] (from the global
 * [SessionsManager]) with a per-tab [TerminalBuffer] that consumes its
 * binary output stream.
 *
 * Opening a tab is idempotent — re-opening an already-open session just
 * focuses the existing tab. Closing a tab terminates the SSH session on the
 * server (DELETE /api/sessions/{id}); use [detachTab] instead to leave the
 * server session running and remove it from local state.
 */
class TerminalScreenViewModel(app: Application) : AndroidViewModel(app) {

    private val sessionsManager: SessionsManager = ApiClient.get(app).sessionsManager
    private val service = ApiClient.get(app).service

    private val _tabs = MutableStateFlow<List<Tab>>(emptyList())
    val tabs: StateFlow<List<Tab>> = _tabs.asStateFlow()

    private val _selectedIndex = MutableStateFlow(0)
    val selectedIndex: StateFlow<Int> = _selectedIndex.asStateFlow()

    private val collectors = mutableMapOf<String, Job>()

    fun setSelected(index: Int) {
        _selectedIndex.value = index.coerceAtLeast(0).coerceAtMost(_tabs.value.lastIndex.coerceAtLeast(0))
    }

    /**
     * Open a tab for the given session id. If the tab already exists, just
     * select it. Otherwise fetch metadata (for the title) and start a
     * TerminalConnection. The foreground TerminalService is (re-)started.
     */
    fun openSession(sessionId: String) {
        val existingIndex = _tabs.value.indexOfFirst { it.sessionId == sessionId }
        if (existingIndex >= 0) {
            _selectedIndex.value = existingIndex
            return
        }
        val connection = sessionsManager.getOrCreate(sessionId)
        val buffer = TerminalBuffer()
        val tab = Tab(sessionId = sessionId, name = sessionId.take(8), connection = connection, buffer = buffer)
        _tabs.update { it + tab }
        _selectedIndex.value = _tabs.value.lastIndex
        startCollector(tab)
        TerminalService.start(getApplication())

        viewModelScope.launch {
            runCatching { service.getSession(sessionId) }
                .getOrNull()
                ?.let { meta -> renameTabLocal(sessionId, meta.name) }
        }
    }

    /**
     * Close a tab AND terminate the session on the server. Use [detachTab]
     * to drop only the local UI state and keep the tmux session alive.
     */
    fun closeTab(sessionId: String) {
        viewModelScope.launch {
            try {
                service.deleteSession(sessionId)
            } catch (ce: CancellationException) {
                throw ce
            } catch (_: Throwable) {
                // Best-effort: still tear down locally so the UI doesn't get stuck.
            }
            detachTab(sessionId)
        }
    }

    /** Local-only: remove the tab and close its WebSocket; server-side session stays alive. */
    fun detachTab(sessionId: String) {
        collectors.remove(sessionId)?.cancel()
        sessionsManager.close(sessionId)
        _tabs.update { it.filterNot { t -> t.sessionId == sessionId } }
        _selectedIndex.value = _selectedIndex.value.coerceAtMost(_tabs.value.lastIndex.coerceAtLeast(0))
    }

    private fun renameTabLocal(sessionId: String, name: String) {
        _tabs.update { list -> list.map { if (it.sessionId == sessionId) it.copy(name = name) else it } }
    }

    private fun startCollector(tab: Tab) {
        if (collectors.containsKey(tab.sessionId)) return
        val job = viewModelScope.launch {
            tab.connection.output.collect { bytes ->
                tab.buffer.write(bytes)
            }
        }
        collectors[tab.sessionId] = job
    }

    override fun onCleared() {
        collectors.values.forEach { it.cancel() }
        collectors.clear()
        // We intentionally do NOT close the WebSockets here — the
        // foreground TerminalService keeps them alive across rotation /
        // brief backgrounding. Use closeTab/detachTab for explicit teardown.
        super.onCleared()
    }

    data class Tab(
        val sessionId: String,
        val name: String,
        val connection: TerminalConnection,
        val buffer: TerminalBuffer,
    )
}
