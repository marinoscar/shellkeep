package cr.marin.shellkeep.terminal

import cr.marin.shellkeep.auth.TokenStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.min

/**
 * One persistent WebSocket bound to one terminal session.
 *
 * Wire protocol per `apps/api/src/terminal/terminal.gateway.ts`:
 *  1. Open WS to `/api/terminal/ws`.
 *  2. Within 5 seconds send `{"type":"auth","token":"<jwt>"}`. Server replies
 *     `auth_ok` or `auth_fail` (then closes).
 *  3. Send `{"type":"connect","sessionId":"<uuid>"}`. Server starts/attaches
 *     the SSH+tmux session and replies `session_ready` or `session_error`.
 *  4. From then on:
 *      - Client writes raw bytes as **binary** frames -> stdin to PTY.
 *      - Server writes raw bytes as **binary** frames -> PTY output.
 *      - Client may send `{"type":"resize","cols":N,"rows":M}` on viewport
 *        changes.
 *  5. Server uses WebSocket-level ping every 30s; OkHttp answers
 *     automatically. We also send `{"type":"ping"}` opportunistically.
 *  6. On disconnect, [connect] is called again externally and an exponential
 *     backoff schedule re-establishes the socket and re-issues auth+connect.
 */
class TerminalConnection(
    private val okHttp: OkHttpClient,
    private val baseUrl: String,
    private val tokenStore: TokenStore,
    val sessionId: String,
    private val scope: CoroutineScope,
) {

    private val json = Json { ignoreUnknownKeys = true; classDiscriminator = "type"; encodeDefaults = true }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    private val _output = MutableSharedFlow<ByteArray>(
        extraBufferCapacity = 128,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val output: SharedFlow<ByteArray> = _output.asSharedFlow()

    @Volatile private var socket: WebSocket? = null
    private val closing = AtomicBoolean(false)
    @Volatile private var reconnectJob: Job? = null
    @Volatile private var attempt: Int = 0

    private var lastCols: Int = 80
    private var lastRows: Int = 24

    fun connect() {
        if (closing.get()) return
        if (_state.value is State.Ready || _state.value is State.Connecting) return
        openSocket()
    }

    private fun openSocket() {
        _state.value = State.Connecting
        val wsUrl = baseUrl.replaceFirst("http", "ws").trimEnd('/') + "/api/terminal/ws"
        val request = Request.Builder().url(wsUrl).build()
        socket = okHttp.newWebSocket(request, Listener())
    }

    /** Push terminal input (e.g. user keystrokes) to the remote PTY. */
    fun sendInput(bytes: ByteArray): Boolean {
        if (_state.value !is State.Ready) return false
        val ws = socket ?: return false
        return ws.send(bytes.toByteString())
    }

    /** Tell the server the viewport changed. Replays the cols-1 -> cols nudge from useTerminal.ts to force tmux to repaint. */
    fun resize(cols: Int, rows: Int) {
        if (cols <= 0 || rows <= 0) return
        lastCols = cols
        lastRows = rows
        val ws = socket ?: return
        if (_state.value !is State.Ready) return
        // Nudge tmux: send cols-1 first then real value 50ms later (mirrors useTerminal.ts).
        ws.sendControl(ControlOut.Resize(cols - 1, rows))
        scope.launch {
            delay(50)
            socket?.takeIf { _state.value is State.Ready }
                ?.sendControl(ControlOut.Resize(cols, rows))
        }
    }

    /** Permanently close this connection. No reconnects after this. */
    fun close() {
        closing.set(true)
        reconnectJob?.cancel()
        socket?.close(1000, "client closing")
        socket = null
        _state.value = State.Closed
    }

    // -------------------------------------------------------------------------
    // OkHttp listener
    // -------------------------------------------------------------------------

    private inner class Listener : WebSocketListener() {

        override fun onOpen(webSocket: WebSocket, response: Response) {
            attempt = 0
            val token = tokenStore.read()?.accessToken
            if (token == null) {
                _state.value = State.Failed("No access token", "NO_TOKEN")
                webSocket.close(1000, "no token")
                return
            }
            _state.value = State.Authenticating
            webSocket.sendControl(ControlOut.Auth(token))
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            handleControl(text)
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            // Binary frame = terminal output bytes.
            val bytesArr = bytes.toByteArray()
            // Heuristic: a JSON control message could arrive as binary if the server
            // ever flips. Cheap check on first byte before forwarding.
            if (bytesArr.isNotEmpty() && bytesArr[0] == '{'.code.toByte()) {
                runCatching { handleControl(String(bytesArr, Charsets.UTF_8)) }
                    .onFailure { _output.tryEmit(bytesArr) }
            } else {
                _output.tryEmit(bytesArr)
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, reason)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (closing.get()) {
                _state.value = State.Closed
                return
            }
            scheduleReconnect("closed: $code $reason")
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (closing.get()) return
            scheduleReconnect("failure: ${t.message}")
        }
    }

    private fun handleControl(text: String) {
        val obj = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: return
        val type = obj["type"]?.jsonPrimitive?.content
        when (ControlIn.fromWire(type)) {
            ControlIn.AUTH_OK -> {
                _state.value = State.Attaching
                socket?.sendControl(ControlOut.Connect(sessionId))
            }
            ControlIn.AUTH_FAIL -> {
                val reason = obj["reason"]?.jsonPrimitive?.content ?: "auth_fail"
                _state.value = State.Failed(reason, "AUTH_FAIL")
                socket?.close(1000, "auth fail")
            }
            ControlIn.SESSION_READY -> {
                _state.value = State.Ready
                // Re-assert last known viewport size so tmux paints at the right dims.
                resize(lastCols, lastRows)
            }
            ControlIn.SESSION_ERROR -> {
                val errorMsg = obj["error"]?.jsonPrimitive?.content ?: "session_error"
                val code = obj["code"]?.jsonPrimitive?.content
                _state.value = State.Failed(errorMsg, code)
            }
            ControlIn.SESSION_ENDED -> {
                val reason = obj["reason"]?.jsonPrimitive?.content ?: "session_ended"
                _state.value = State.Ended(reason)
            }
            ControlIn.PONG -> Unit
            null -> Unit // Unknown control type; ignore for forward-compat.
        }
    }

    private fun scheduleReconnect(reason: String) {
        if (closing.get()) return
        // Don't auto-reconnect on terminal session_error (e.g. NOT_FOUND, TERMINATED).
        val current = _state.value
        if (current is State.Failed && current.code in TERMINAL_ERROR_CODES) {
            _state.value = State.Closed
            return
        }
        _state.value = State.Reconnecting(reason, attempt)
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val backoffMs = min(BACKOFF_MAX_MS, 500L * (1 shl attempt.coerceAtMost(6)))
            delay(backoffMs)
            attempt++
            openSocket()
        }
    }

    private fun WebSocket.sendControl(msg: ControlOut) {
        val text = json.encodeToString(ControlOut.serializer(), msg)
        send(text)
    }

    sealed interface State {
        data object Idle : State
        data object Connecting : State
        data object Authenticating : State
        data object Attaching : State
        data object Ready : State
        data class Failed(val reason: String, val code: String? = null) : State
        data class Reconnecting(val cause: String, val attempt: Int) : State
        data class Ended(val reason: String) : State
        data object Closed : State
    }

    private companion object {
        const val BACKOFF_MAX_MS: Long = 30_000L
        // Per terminal.gateway.ts: NOT_FOUND, TERMINATED, ATTACH_FAILED don't recover
        // by reconnecting — the session is gone. CONNECTION_FAILED may be transient.
        val TERMINAL_ERROR_CODES: Set<String> = setOf("NOT_FOUND", "TERMINATED", "ATTACH_FAILED", "AUTH_FAIL")
    }
}
