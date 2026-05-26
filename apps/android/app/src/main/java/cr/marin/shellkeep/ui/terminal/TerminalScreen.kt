package cr.marin.shellkeep.ui.terminal

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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel

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

    // Keep ViewModel.selectedIndex in sync with the user's pager swipe.
    LaunchedEffect(pagerState.currentPage) {
        if (pagerState.currentPage != selectedIndex) {
            viewModel.setSelected(pagerState.currentPage)
        }
    }
    // And programmatic selection back into the pager.
    LaunchedEffect(selectedIndex, tabs.size) {
        if (selectedIndex != pagerState.currentPage && selectedIndex < tabs.size) {
            pagerState.scrollToPage(selectedIndex)
        }
    }

    val currentTab = tabs.getOrNull(selectedIndex)

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
            )
        },
        bottomBar = {
            VirtualKeyBar(onBytes = { bytes ->
                currentTab?.connection?.sendInput(bytes)
            })
        },
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
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(text = tab.name)
                                    IconButton(
                                        onClick = { viewModel.detachTab(tab.sessionId) },
                                    ) {
                                        Icon(
                                            Icons.Filled.Close,
                                            contentDescription = "Close tab",
                                        )
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
