package ai.drsai.remote.data

object ModelRecommendationPolicy {
    fun select(
        models: List<ModelInfo>,
        providers: List<ModelProviderConfig>,
        currentModelId: String?,
    ): ModelInfo? {
        val providerById = providers.associateBy(ModelProviderConfig::id)
        fun eligible(model: ModelInfo): Boolean = model.enabled && model.tools &&
            providerById[model.providerId]?.let { it.id == "hepai" || it.connectionStatus == "AVAILABLE" } == true
        return currentModelId?.let { id -> models.firstOrNull { eligible(it) && (it.id == id || it.upstreamId == id) } }
            ?: orderPreferredDeepseekModels(models.filter(::eligible)).firstOrNull()
    }
}
