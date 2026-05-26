package cr.marin.shellkeep.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import cr.marin.shellkeep.auth.AuthManager
import cr.marin.shellkeep.net.ApiClient
import cr.marin.shellkeep.ui.pairing.PairingScreen
import cr.marin.shellkeep.ui.sessions.SessionsScreen
import cr.marin.shellkeep.ui.terminal.TerminalScreen

object Routes {
    const val PAIRING = "pairing"
    const val SESSIONS = "sessions"
    const val TERMINAL = "terminal/{sessionId}"
    const val SETTINGS = "settings"

    fun terminal(sessionId: String) = "terminal/$sessionId"
}

@Composable
fun ShellKeepNavGraph(modifier: Modifier = Modifier) {
    val nav = rememberNavController()
    val context = LocalContext.current
    val authState by ApiClient.get(context).authManager.state.collectAsStateWithLifecycle()

    val startRoute = when (authState) {
        AuthManager.AuthState.Authenticated -> Routes.SESSIONS
        else -> Routes.PAIRING
    }

    // Whenever auth state flips, hop the user to the appropriate root.
    LaunchedEffect(authState) {
        when (authState) {
            AuthManager.AuthState.Authenticated ->
                nav.navigateTopLevel(Routes.SESSIONS)
            AuthManager.AuthState.Unauthenticated ->
                nav.navigateTopLevel(Routes.PAIRING)
            else -> Unit
        }
    }

    NavHost(
        navController = nav,
        startDestination = startRoute,
        modifier = modifier.fillMaxSize(),
    ) {
        composable(Routes.PAIRING) {
            PairingScreen(onPaired = { nav.navigateTopLevel(Routes.SESSIONS) })
        }
        composable(Routes.SESSIONS) {
            SessionsScreen(
                onOpenSession = { id -> nav.navigate(Routes.terminal(id)) },
                onOpenSettings = { nav.navigate(Routes.SETTINGS) },
            )
        }
        composable(Routes.TERMINAL) { backstack ->
            val sessionId = backstack.arguments?.getString("sessionId") ?: return@composable
            TerminalScreen(
                initialSessionId = sessionId,
                onBack = { nav.popBackStack() },
            )
        }
        composable(Routes.SETTINGS) {
            // Settings UI lands in a follow-up commit (Task #12).
            Text(text = "Settings (coming soon)")
        }
    }
}

private fun NavHostController.navigateTopLevel(route: String) {
    navigate(route) {
        popUpTo(graph.startDestinationId) { inclusive = true }
        launchSingleTop = true
    }
}
