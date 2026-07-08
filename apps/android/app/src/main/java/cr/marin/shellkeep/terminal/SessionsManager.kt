package cr.marin.shellkeep.terminal

import cr.marin.shellkeep.auth.TokenStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.OkHttpClient
import java.util.concurrent.ConcurrentHashMap

/**
 * App-scoped singleton that owns every live [TerminalConnection]. Multiple
 * sessions can run in parallel; each one keeps its own WebSocket and produces
 * its own output stream. Switching tabs in the UI is instant because each
 * connection is already running.
 *
 * The manager has its own [SupervisorJob] scope so that a crash in one
 * session doesn't take down the others. Reconnect logic lives inside
 * [TerminalConnection]; the manager just hands out connection handles and
 * tears them down when the user closes a tab.
 *
 * Lifecycle is independent of any UI component — the [TerminalService]
 * foreground service ensures the process (and therefore this scope) stays
 * alive while sessions are running.
 */
class SessionsManager(
    private val okHttp: OkHttpClient,
    private val baseUrl: String,
    private val tokenStore: TokenStore,
) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val connections = ConcurrentHashMap<String, TerminalConnection>()

    private val _activeIds = MutableStateFlow<Set<String>>(emptySet())
    val activeIds: StateFlow<Set<String>> = _activeIds.asStateFlow()

    /**
     * Returns the existing connection for [sessionId] or creates a fresh one
     * (already calling [TerminalConnection.connect]). Idempotent.
     */
    fun getOrCreate(sessionId: String): TerminalConnection {
        return connections.computeIfAbsent(sessionId) {
            TerminalConnection(
                okHttp = okHttp,
                baseUrl = baseUrl,
                tokenStore = tokenStore,
                sessionId = sessionId,
                scope = scope,
            ).also {
                it.connect()
                _activeIds.value = connections.keys.toSet()
            }
        }
    }

    fun get(sessionId: String): TerminalConnection? = connections[sessionId]

    /** Close a single session and remove it from the manager. */
    fun close(sessionId: String) {
        connections.remove(sessionId)?.close()
        _activeIds.value = connections.keys.toSet()
    }

    /** Close every live session. Used by the foreground notification's "Disconnect all". */
    fun closeAll() {
        connections.values.forEach { it.close() }
        connections.clear()
        _activeIds.value = emptySet()
    }

    fun count(): Int = connections.size
}
