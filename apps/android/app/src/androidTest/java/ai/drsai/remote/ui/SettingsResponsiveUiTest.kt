package ai.drsai.remote.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import ai.drsai.remote.data.AppState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class SettingsResponsiveUiTest {
    @get:Rule val rule = createComposeRule()

    @Test fun phoneWidthUsesDrillDownNavigation() {
        var modelOpens = 0
        rule.setContent {
            MaterialTheme {
                Box(Modifier.width(600.dp).height(900.dp)) {
                    SettingsScreen(AppState(), {}, { modelOpens += 1 })
                }
            }
        }
        rule.onNodeWithTag("settings-navigation-compact").assertIsDisplayed()
        rule.onNodeWithTag("settings-detail").assertDoesNotExist()
        rule.onNodeWithText("默认配置").performClick()
        rule.runOnIdle { assertEquals(1, modelOpens) }
    }

    @Test fun tabletWidthUsesGroupedTwoPaneLayout() {
        rule.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, 1f)) {
                MaterialTheme {
                    Box(Modifier.requiredWidth(900.dp).height(900.dp)) {
                        SettingsScreen(AppState(), {}, {})
                    }
                }
            }
        }
        rule.onNodeWithTag("settings-navigation-wide").assertIsDisplayed()
        rule.onNodeWithTag("settings-detail").assertIsDisplayed()
        rule.onNodeWithText("智能体").assertIsDisplayed()
        rule.onNodeWithText("默认模型").assertIsDisplayed()
    }

    @Test fun compactSettingsRemainOperableAtOneHundredFiftyPercentFontScale() {
        var modelOpens = 0
        rule.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 1.5f)) {
                MaterialTheme {
                    Box(Modifier.width(600.dp).height(900.dp)) {
                        SettingsScreen(AppState(), {}, { modelOpens += 1 })
                    }
                }
            }
        }
        rule.onNodeWithText("默认配置").assertIsDisplayed().performClick()
        rule.runOnIdle { assertEquals(1, modelOpens) }
    }

    @Test fun compactSettingsRemainOperableAtOneHundredThirtyPercentFontScale() {
        var modelOpens = 0
        rule.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 1.3f)) {
                MaterialTheme {
                    Box(Modifier.width(600.dp).height(900.dp)) {
                        SettingsScreen(AppState(), {}, { modelOpens += 1 })
                    }
                }
            }
        }
        rule.onNodeWithText("默认配置").assertIsDisplayed().performClick()
        rule.runOnIdle { assertEquals(1, modelOpens) }
    }
}
