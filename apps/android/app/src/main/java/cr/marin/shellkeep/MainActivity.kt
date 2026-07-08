package cr.marin.shellkeep

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import cr.marin.shellkeep.net.ApiClient
import cr.marin.shellkeep.ui.ShellKeepNavGraph
import cr.marin.shellkeep.ui.theme.ShellKeepTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Initialise the process-wide singleton early so SessionsManager exists
        // before the first navigation event.
        ApiClient.get(applicationContext)
        enableEdgeToEdge()
        setContent {
            ShellKeepTheme {
                ShellKeepNavGraph()
            }
        }
    }
}
