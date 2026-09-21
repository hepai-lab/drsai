package ai.drsai.remote

import ai.drsai.remote.runtime.setup.*
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SetupJourneyStoreInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val account = "p10-resume-test@example.invalid"

    @After fun cleanup() {
        SharedPreferencesSetupJourneyStore(context).clear(account)
    }

    @Test fun everyActiveStepSurvivesStoreReconstructionWithoutSecrets() {
        SetupStep.entries.filter { it != SetupStep.COMPLETE }.forEachIndexed { index, step ->
            val before = SetupJourney(step, SetupStatus.ACTIVE, index.toLong() + 1, "safe_reason")
            SharedPreferencesSetupJourneyStore(context).save(account, before)

            // A fresh store instance exercises the same durable boundary used after process death.
            val after = SharedPreferencesSetupJourneyStore(context).load(account)
            assertEquals(before, after)
        }

        val raw = context.getSharedPreferences("p10_setup_journey_v1", Context.MODE_PRIVATE).all.toString()
        assertFalse(raw.contains("api-key", ignoreCase = true))
        assertFalse(raw.contains("Bearer ", ignoreCase = true))
    }

    @Test fun skippedAndCompleteStatesSurviveReconstruction() {
        listOf(
            SetupJourney(SetupStep.MODEL_PROVIDER, SetupStatus.SKIPPED, 10, "credential_missing"),
            SetupJourney(SetupStep.COMPLETE, SetupStatus.COMPLETE, 11, null),
        ).forEach { before ->
            SharedPreferencesSetupJourneyStore(context).save(account, before)
            assertEquals(before, SharedPreferencesSetupJourneyStore(context).load(account))
        }
    }
}
