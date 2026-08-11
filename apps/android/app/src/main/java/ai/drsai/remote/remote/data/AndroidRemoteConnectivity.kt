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
    private val mutableOnline = MutableStateFlow(isUsable(manager.activeNetwork))
    val online: StateFlow<Boolean> = mutableOnline.asStateFlow()
    private val mutableMetered = MutableStateFlow(manager.isActiveNetworkMetered)
    val metered: StateFlow<Boolean> = mutableMetered.asStateFlow()
    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { refresh(network) }
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            mutableOnline.value = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            mutableMetered.value = !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
        }
        override fun onLost(network: Network) { refresh(manager.activeNetwork) }
    }
    init { manager.registerDefaultNetworkCallback(callback) }
    private fun refresh(network: Network?) {
        mutableOnline.value = isUsable(network)
        mutableMetered.value = manager.isActiveNetworkMetered
    }
    private fun isUsable(network: Network?): Boolean = network != null && manager.getNetworkCapabilities(network)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    override fun close() { runCatching { manager.unregisterNetworkCallback(callback) } }
}
