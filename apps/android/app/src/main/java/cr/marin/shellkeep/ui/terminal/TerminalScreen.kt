package cr.marin.shellkeep.ui.terminal

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import cr.marin.shellkeep.net.ApiClient
import cr.marin.shellkeep.util.Clipboard
import cr.marin.shellkeep.util.ImageUploader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalScreen(
    initialSessionId: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: TerminalScreenViewModel = viewModel(),
) {
    val tabs by viewModel.tabs.collectAsStateWithLifecycle()
    val selectedIndex by viewModel.selectedIndex.collectAsStateWithLifecycle()

    LaunchedEffect(initialSessionId) {
        viewModel.openSession(initialSessionId)
    }

    val pagerState = rememberPagerState(
        initialPage = selectedIndex.coerceAtLeast(0),
        pageCount = { tabs.size.coerceAtLeast(1) },
    )

    LaunchedEffect(pagerState.currentPage) {
        if (pagerState.currentPage != selectedIndex) {
            viewModel.setSelected(pagerState.currentPage)
        }
    }
    LaunchedEffect(selectedIndex, tabs.size) {
        if (selectedIndex != pagerState.currentPage && selectedIndex < tabs.size) {
            pagerState.scrollToPage(selectedIndex)
        }
    }

    val currentTab = tabs.getOrNull(selectedIndex)
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    val pickImage = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val tab = currentTab ?: return@rememberLauncherForActivityResult
        coroutineScope.launch {
            try {
                val url = ImageUploader.uploadAndGetUrl(
                    context = context,
                    service = ApiClient.get(context).service,
                    uri = uri,
                )
                if (url != null) {
                    tab.connection.sendInput(url.toByteArray(Charsets.UTF_8))
                    snackbar.showSnackbar("Image uploaded and URL pasted")
                } else {
                    snackbar.showSnackbar("Image upload failed")
                }
            } catch (ce: CancellationException) {
                throw ce
            } catch (t: Throwable) {
                snackbar.showSnackbar("Image upload failed: ${t.message ?: "unknown error"}")
            }
        }
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text(currentTab?.name ?: "Terminal") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    IconButton(
                        enabled = currentTab != null,
                        onClick = {
                            val tab = currentTab ?: return@IconButton
                            Clipboard.writeText(context, tab.buffer.text.value)
                            coroutineScope.launch { snackbar.showSnackbar("Copied to clipboard") }
                        },
                    ) {
                        Icon(Icons.Filled.ContentCopy, contentDescription = "Copy all")
                    }
                    IconButton(
                        enabled = currentTab != null,
                        onClick = {
                            val tab = currentTab ?: return@IconButton
                            val text = Clipboard.readText(context)
                            if (text.isNullOrEmpty()) {
                                coroutineScope.launch { snackbar.showSnackbar("Clipboard is empty") }
                            } else {
                                tab.connection.sendInput(text.toByteArray(Charsets.UTF_8))
                            }
                        },
                    ) {
                        Icon(Icons.Filled.ContentPaste, contentDescription = "Paste")
                    }
                    IconButton(
                        enabled = currentTab != null,
                        onClick = {
                            pickImage.launch(
                                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                            )
                        },
                    ) {
                        Icon(Icons.Filled.Image, contentDescription = "Paste image")
                    }
                },
            )
        },
        bottomBar = {
            VirtualKeyBar(onBytes = { bytes ->
                currentTab?.connection?.sendInput(bytes)
            })
        },
        snackbarHost = { SnackbarHost(hostState = snackbar) },
    ) { innerPadding ->
        Column(modifier = Modifier.padding(innerPadding).fillMaxSize()) {
            if (tabs.size > 1) {
                ScrollableTabRow(
                    selectedTabIndex = selectedIndex,
                    edgePadding = 0.dp,
                ) {
                    tabs.forEachIndexed { index, tab ->
                        Tab(
                            selected = index == selectedIndex,
                            onClick = { viewModel.setSelected(index) },
                            text = {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(text = tab.name)
                                    IconButton(onClick = { viewModel.detachTab(tab.sessionId) }) {
                                        Icon(Icons.Filled.Close, contentDescription = "Close tab")
                                    }
                                }
                            },
                        )
                    }
                }
            }

            if (tabs.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Loading…", style = MaterialTheme.typography.bodyMedium)
                }
            } else {
                HorizontalPager(
                    state = pagerState,
                    modifier = Modifier.fillMaxWidth().weight(1f),
                ) { page ->
                    val tab = tabs.getOrNull(page) ?: return@HorizontalPager
                    val text by tab.buffer.text.collectAsStateWithLifecycle()
                    TerminalPane(
                        connection = tab.connection,
                        text = text,
                    )
                }
            }
        }
    }
}
