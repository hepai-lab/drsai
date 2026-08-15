package ai.drsai.remote.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import ai.drsai.remote.data.AppState
import ai.drsai.remote.remote.model.OaepTimelineEntry

/** Release-like, deterministic pages used only by the external Macrobenchmark APK. */
class PerformanceFixtureActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val page = intent.getStringExtra(EXTRA_PAGE).orEmpty()
        setContent {
            MaterialTheme {
                Box(Modifier.fillMaxSize().semantics { testTagsAsResourceId = true }) { when (page) {
                    PAGE_SETUP -> AgentSetupCard(AppState(), {}, {}, {}, {}, {})
                    PAGE_TIMELINE -> OaepTimeline(
                        entries = List(500) { index ->
                            OaepTimelineEntry.UserMessage("message-$index", "Performance message $index")
                        },
                        snapshotSequence = 500,
                        composerExpanded = false,
                        modifier = Modifier.fillMaxSize(),
                    )
                    PAGE_MODELS -> LazyColumn(Modifier.fillMaxSize().testTag("performance-model-list")) {
                        items(List(1_000) { "provider/model-$it" }, key = { it }) { model -> Text(model) }
                    }
                    else -> Text("OpenDrSai benchmark fixture")
                } }
            }
        }
    }

    companion object {
        const val EXTRA_PAGE = "page"
        const val PAGE_SETUP = "setup"
        const val PAGE_TIMELINE = "timeline-500"
        const val PAGE_MODELS = "models-1000"
    }
}
