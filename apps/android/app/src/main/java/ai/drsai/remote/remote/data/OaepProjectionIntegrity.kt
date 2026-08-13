package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.generated.OaepItem
import ai.drsai.remote.remote.generated.OaepSnapshot
import ai.drsai.remote.remote.model.oaepItemsDigest
import org.json.JSONArray
import org.json.JSONObject

/** Canonical OAEP Item digest shared with the Runtime checkpoint contract. */
object OaepProjectionIntegrity {
    fun verifyCompleteSnapshot(snapshot: OaepSnapshot) {
        val checkpoint = snapshot.checkpoint ?: return
        val window = snapshot.window ?: return
        val complete = !window.hasMore && checkpoint.itemCount == snapshot.items.size.toLong()
        if (!complete) return
        require(digestItems(snapshot.items) == checkpoint.snapshotHash) {
            "oaep_snapshot_checkpoint_digest_mismatch"
        }
    }

    fun digestItems(items: JSONArray): String {
        val sorted = (0 until items.length()).map { items.getJSONObject(it) }
            .sortedWith(compareBy<JSONObject>(
                { it.getString("run_id") },
                { it.getLong("sequence") },
                { it.getString("id") },
            ))
        return oaepItemsDigest(sorted.map(OaepJsonCodec::item))
    }

    fun digestItems(items: List<OaepItem>): String = oaepItemsDigest(items)
}
