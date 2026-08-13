package ai.drsai.remote.remote.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class AndroidRemoteConnectivity(context: Context) : AutoCloseable {
    private val manager = context.getSystemService(ConnectivityManager::class.java)
    private var currentNetwork: Network? = manager.activeNetwork
    private val mutableOnline = MutableStateFlow(isUsable(currentNetwork))
    val online: StateFlow<Boolean> = mutableOnline.asStateFlow()
    private val mutableMetered = MutableStateFlow(manager.isActiveNetworkMetered)
    val metered: StateFlow<Boolean> = mutableMetered.asStateFlow()
    private val generation = RemoteNetworkGenerationTracker(
        currentNetwork?.toString(), mutableOnline.value, mutableMetered.value,
    )
    private val mutableState = MutableStateFlow(
        generation.state,
    )
    val state: StateFlow<RemoteNetworkState> = mutableState.asStateFlow()
    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { refresh(network) }
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            publish(
                network,
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
                !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
            )
        }
        override fun onLost(network: Network) { refresh(manager.activeNetwork) }
    }
    init { manager.registerDefaultNetworkCallback(callback) }
    private fun refresh(network: Network?) {
        publish(network, isUsable(network), manager.isActiveNetworkMetered)
    }
    @Synchronized
    private fun publish(network: Network?, online: Boolean, metered: Boolean) {
        currentNetwork = network
        mutableOnline.value = online
        mutableMetered.value = metered
        mutableState.value = generation.observe(network?.toString(), online, metered)
    }
    private fun isUsable(network: Network?): Boolean = network != null && manager.getNetworkCapabilities(network)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    override fun close() { runCatching { manager.unregisterNetworkCallback(callback) } }
}
