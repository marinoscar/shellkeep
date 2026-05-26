package cr.marin.shellkeep.terminal

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import cr.marin.shellkeep.MainActivity
import cr.marin.shellkeep.R
import cr.marin.shellkeep.net.ApiClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * Foreground service that keeps the process (and therefore [SessionsManager])
 * alive while at least one terminal session is connected. The service is
 * started by [Companion.start] from whatever holds the first live session and
 * stops itself automatically when [SessionsManager.activeIds] empties.
 *
 * A persistent notification surfaces the live-session count and offers a
 * "Disconnect all" action so the user can shut everything down without
 * unlocking the app.
 */
class TerminalService : Service() {

    private val scope = CoroutineScope(SupervisorJob())
    private var watcherJob: Job? = null
    private val binder = LocalBinder()

    inner class LocalBinder : Binder() {
        fun service(): TerminalService = this@TerminalService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_DISCONNECT_ALL) {
            ApiClient.get(applicationContext).sessionsManager.closeAll()
            stopSelfInternal()
            return START_NOT_STICKY
        }

        ensureChannel()
        startInForeground(activeCount = ApiClient.get(applicationContext).sessionsManager.count())
        watchSessions()
        return START_STICKY
    }

    override fun onDestroy() {
        watcherJob?.cancel()
        super.onDestroy()
    }

    private fun watchSessions() {
        if (watcherJob?.isActive == true) return
        watcherJob = scope.launch {
            ApiClient.get(applicationContext).sessionsManager.activeIds.collectLatest { ids ->
                if (ids.isEmpty()) {
                    stopSelfInternal()
                } else {
                    updateNotification(ids.size)
                }
            }
        }
    }

    private fun stopSelfInternal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    private fun startInForeground(activeCount: Int) {
        val notification = buildNotification(activeCount)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification(activeCount: Int) {
        val mgr = ContextCompat.getSystemService(this, NotificationManager::class.java) ?: return
        mgr.notify(NOTIFICATION_ID, buildNotification(activeCount))
    }

    private fun buildNotification(activeCount: Int): Notification {
        val openAppIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val disconnectIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, TerminalService::class.java).setAction(ACTION_DISCONNECT_ALL),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val text = resources.getQuantityString(
            R.plurals.terminal_service_notification_count,
            activeCount,
            activeCount,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth) // placeholder until we ship an icon
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setContentIntent(openAppIntent)
            .addAction(
                0,
                getString(R.string.terminal_service_disconnect_all),
                disconnectIntent,
            )
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = ContextCompat.getSystemService(this, NotificationManager::class.java) ?: return
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.terminal_service_channel),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.terminal_service_channel)
            setShowBadge(false)
        }
        mgr.createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "terminal_sessions"
        const val NOTIFICATION_ID = 1001
        const val ACTION_DISCONNECT_ALL = "cr.marin.shellkeep.action.DISCONNECT_ALL"

        /** Call once at least one session is live. Idempotent. */
        fun start(context: Context) {
            val intent = Intent(context, TerminalService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }
    }
}
