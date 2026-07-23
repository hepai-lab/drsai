package ai.drsai.remote

import android.content.ComponentName
import android.content.Context
import android.content.pm.ServiceInfo
import android.content.pm.ApplicationInfo
import androidx.work.WorkManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.runtime.device.LocalRunForegroundService
import ai.drsai.remote.runtime.device.SafeDeviceInfoProvider
import ai.drsai.remote.runtime.reliability.BackgroundRunKeys
import ai.drsai.remote.runtime.reliability.RunRecoveryScheduler
import ai.drsai.remote.workbench.model.WorkbenchId
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidLocalCapabilitiesInstrumentedTest {
    @Test fun safeDeviceSnapshotContainsOnlyTheDocumentedNonIdentifyingFields() {
        val snapshot = SafeDeviceInfoProvider(ApplicationProvider.getApplicationContext()).snapshot()
        assertTrue(snapshot.sdk >= 26)
        assertTrue(snapshot.locale.isNotBlank())
        assertTrue(snapshot.timeZone.isNotBlank())
        assertTrue(snapshot.networkType in setOf("wifi", "cellular", "ethernet", "other", "offline"))
        val rendered = snapshot.toString().lowercase()
        listOf("android_id", "imei", "serial", "latitude", "longitude", "ssid", "bssid").forEach {
            assertFalse(rendered.contains(it))
        }
    }

    @Test fun localRunServiceDeclaresTheRequiredDataSyncForegroundType() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        @Suppress("DEPRECATION")
        val info = context.packageManager.getServiceInfo(ComponentName(context, LocalRunForegroundService::class.java), 0)
        assertTrue(info.foregroundServiceType and ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC != 0)
    }

    @Test fun applicationBackupIsDisabledSoTokensAndDatabaseCannotEnterCloudBackup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        @Suppress("DEPRECATION")
        val info = context.packageManager.getApplicationInfo(context.packageName, 0)
        assertEquals(0, info.flags and ApplicationInfo.FLAG_ALLOW_BACKUP)
    }

    @Test fun recoverySchedulingKeepsExactlyOneWorkItemPerAccountAndRun() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val manager = WorkManager.getInstance(context)
        val subject = "test-${UUID.randomUUID()}"
        val runId = WorkbenchId("run-${UUID.randomUUID()}")
        val scheduler = RunRecoveryScheduler(manager)
        scheduler.schedule(subject, runId)
        scheduler.schedule(subject, runId)
        val items = manager.getWorkInfosForUniqueWork(
            BackgroundRunKeys.uniqueWorkName(subject, runId),
        ).get(10, TimeUnit.SECONDS)
        assertEquals(1, items.size)
        scheduler.cancel(subject, runId)
    }
}
