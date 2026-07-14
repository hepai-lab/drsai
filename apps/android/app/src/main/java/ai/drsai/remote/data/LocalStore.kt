package ai.drsai.remote.data

import android.content.Context
import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "conversations", indices = [Index("userId")])
data class ConversationEntity(
    @PrimaryKey val id: String,
    val userId: String,
    val title: String,
    val agentId: String,
    @ColumnInfo(defaultValue = "'OpenDrSai'") val agentName: String = "OpenDrSai",
    @ColumnInfo(defaultValue = "'local'") val agentSource: String = "local",
    val modelId: String,
    val createdAt: Long,
    val updatedAt: Long,
)

@Entity(tableName = "agent_catalog", primaryKeys = ["id", "userId"], indices = [Index("userId")])
data class AgentCatalogEntity(
    val id: String,
    val userId: String,
    val platformId: String,
    val name: String,
    val description: String,
    val mode: String,
    val available: Boolean,
    val chatSupported: Boolean,
    val isDefault: Boolean,
    val owner: String?,
    val capabilitiesJson: String,
    val logoUrl: String?,
    val examplesJson: String,
    val savedAt: Long,
)

@Entity(
    tableName = "messages",
    foreignKeys = [ForeignKey(
        entity = ConversationEntity::class,
        parentColumns = ["id"],
        childColumns = ["conversationId"],
        onDelete = ForeignKey.CASCADE,
    )],
    indices = [Index("conversationId")],
)
data class MessageEntity(
    @PrimaryKey val id: String,
    val conversationId: String,
    val role: String,
    val content: String,
    val toolCallId: String? = null,
    val toolName: String? = null,
    val toolPayload: String? = null,
    @ColumnInfo(defaultValue = "1") val visible: Boolean = true,
    val status: String = "complete",
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "memories", indices = [Index("userId")])
data class MemoryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val userId: String,
    val content: String,
    val createdAt: Long = System.currentTimeMillis(),
)

@Dao
interface ChatDao {
    @Query("SELECT * FROM conversations WHERE userId=:userId ORDER BY updatedAt DESC")
    fun conversations(userId: String): Flow<List<ConversationEntity>>

    @Query("SELECT * FROM conversations WHERE userId=:userId ORDER BY updatedAt DESC")
    suspend fun conversationSnapshot(userId: String): List<ConversationEntity>

    @Query("SELECT * FROM messages WHERE conversationId=:id AND visible=1 ORDER BY createdAt")
    suspend fun visibleMessageSnapshot(id: String): List<MessageEntity>

    @Query("SELECT * FROM messages WHERE conversationId=:id ORDER BY createdAt")
    suspend fun runtimeMessageSnapshot(id: String): List<MessageEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveConversation(item: ConversationEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveMessage(item: MessageEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveMessages(items: List<MessageEntity>)

    @Query("UPDATE conversations SET title=:title, updatedAt=:updatedAt WHERE id=:id")
    suspend fun updateConversation(id: String, title: String, updatedAt: Long)

    @Query("DELETE FROM conversations WHERE id=:id")
    suspend fun deleteConversation(id: String)

    @Insert
    suspend fun saveMemory(item: MemoryEntity): Long

    @Query("SELECT * FROM memories WHERE userId=:userId AND content LIKE '%' || :query || '%' ORDER BY createdAt DESC LIMIT :limit")
    suspend fun searchMemories(userId: String, query: String, limit: Int): List<MemoryEntity>

    @Query("SELECT * FROM agent_catalog WHERE userId=:userId ORDER BY isDefault DESC, name COLLATE NOCASE")
    suspend fun agentCatalogSnapshot(userId: String): List<AgentCatalogEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveAgentCatalog(items: List<AgentCatalogEntity>)

    @Query("DELETE FROM agent_catalog WHERE userId=:userId")
    suspend fun clearAgentCatalog(userId: String)
}

@Database(
    entities = [ConversationEntity::class, MessageEntity::class, MemoryEntity::class, AgentCatalogEntity::class],
    version = 3,
    exportSchema = false,
)
abstract class ChatDatabase : RoomDatabase() {
    abstract fun dao(): ChatDao
}

val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        // The v1 cache contained server-owned numeric IDs. It cannot safely be
        // mixed with the local, user-scoped Runtime, so it is discarded once.
        db.execSQL("DROP TABLE IF EXISTS messages")
        db.execSQL("DROP TABLE IF EXISTS conversations")
        db.execSQL("CREATE TABLE IF NOT EXISTS conversations (id TEXT NOT NULL, userId TEXT NOT NULL, title TEXT NOT NULL, agentId TEXT NOT NULL, modelId TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(id))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_conversations_userId ON conversations(userId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS messages (id TEXT NOT NULL, conversationId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, toolCallId TEXT, toolName TEXT, toolPayload TEXT, visible INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, createdAt INTEGER NOT NULL, PRIMARY KEY(id), FOREIGN KEY(conversationId) REFERENCES conversations(id) ON UPDATE NO ACTION ON DELETE CASCADE)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_messages_conversationId ON messages(conversationId)")
        db.execSQL("CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, userId TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL)")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_memories_userId ON memories(userId)")
    }
}

class SecureTokenStore(context: Context) : AuthTokenStore {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "opendrsai_auth",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override var accessToken: String?
        get() = prefs.getString("access", null)
        set(value) = prefs.edit().putString("access", value).apply()
    override var refreshToken: String?
        get() = prefs.getString("refresh", null)
        set(value) = prefs.edit().putString("refresh", value).apply()
    var userId: String?
        get() = prefs.getString("user", null)
        set(value) = prefs.edit().putString("user", value).apply()
    var userName: String?
        get() = prefs.getString("user_name", null)
        set(value) = prefs.edit().putString("user_name", value).apply()
    var avatarUrl: String?
        get() = prefs.getString("avatar", null)
        set(value) = prefs.edit().putString("avatar", value).apply()
    var selectedModelId: String?
        get() = prefs.getString("model", null)
        set(value) = prefs.edit().putString("model", value).apply()
    var selectedAgentId: String?
        get() = prefs.getString("agent", null)
        set(value) = prefs.edit().putString("agent", value).apply()
    var oidcClientId: String?
        get() = prefs.getString("oidc_client_id", null)
        set(value) = prefs.edit().putString("oidc_client_id", value).apply()

    override fun save(auth: AuthTokens) {
        accessToken = auth.accessToken
        refreshToken = auth.refreshToken
        userId = auth.user.id
        userName = auth.user.name
        avatarUrl = auth.user.avatarUrl
    }

    fun user(): User? = userId?.let { User(it, userName ?: it, avatarUrl) }
    fun clear() = prefs.edit().clear().apply()
}

val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE conversations ADD COLUMN agentName TEXT NOT NULL DEFAULT 'OpenDrSai'")
        db.execSQL("ALTER TABLE conversations ADD COLUMN agentSource TEXT NOT NULL DEFAULT 'local'")
        db.execSQL("UPDATE conversations SET agentId='local:opendrsai' WHERE agentId='opendrsai-android'")
        db.execSQL("CREATE TABLE IF NOT EXISTS agent_catalog (id TEXT NOT NULL, userId TEXT NOT NULL, platformId TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, mode TEXT NOT NULL, available INTEGER NOT NULL, chatSupported INTEGER NOT NULL, isDefault INTEGER NOT NULL, owner TEXT, capabilitiesJson TEXT NOT NULL, logoUrl TEXT, examplesJson TEXT NOT NULL, savedAt INTEGER NOT NULL, PRIMARY KEY(id, userId))")
        db.execSQL("CREATE INDEX IF NOT EXISTS index_agent_catalog_userId ON agent_catalog(userId)")
    }
}

class OidcTransactionStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "opendrsai_oidc_transaction",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun save(transaction: OidcLoginTransaction) {
        prefs.edit()
            .putString("client_id", transaction.clientId)
            .putString("redirect_uri", transaction.redirectUri)
            .putString("verifier", transaction.verifier)
            .putString("state", transaction.state)
            .putString("nonce", transaction.nonce)
            .putLong("created_at", transaction.createdAt)
            .commit()
    }

    fun load(): OidcLoginTransaction? {
        val transaction = OidcLoginTransaction(
            clientId = prefs.getString("client_id", null).orEmpty(),
            redirectUri = prefs.getString("redirect_uri", null).orEmpty(),
            verifier = prefs.getString("verifier", null).orEmpty(),
            state = prefs.getString("state", null).orEmpty(),
            nonce = prefs.getString("nonce", null).orEmpty(),
            createdAt = prefs.getLong("created_at", 0L),
        )
        return transaction.takeIf {
            it.clientId.isNotBlank() && it.redirectUri.isNotBlank() && it.verifier.isNotBlank() &&
                it.state.isNotBlank() && it.nonce.isNotBlank() && it.createdAt > 0
        } ?: run { clear(); null }
    }

    fun clear() {
        prefs.edit().clear().commit()
    }
}
