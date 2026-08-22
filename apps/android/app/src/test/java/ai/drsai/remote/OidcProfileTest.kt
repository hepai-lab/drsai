package ai.drsai.remote

import ai.drsai.remote.data.normalizeOidcAvatarUrl
import ai.drsai.remote.data.oidcUser
import ai.drsai.remote.data.userAvatarInitials
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OidcProfileTest {
    @Test fun `standard picture claim becomes the signed in user avatar`() {
        val user = oidcUser(
            JSONObject("""{"sub":"user-1","name":"张 德","picture":"https://images.ihep.ac.cn/avatar/u1.png?rev=2"}"""),
            JSONObject("""{"sub":"user-1"}"""),
        )
        assertEquals("张 德", user.name)
        assertEquals("https://images.ihep.ac.cn/avatar/u1.png?rev=2", user.avatarUrl)
        assertEquals("张德", userAvatarInitials(user.name))
    }

    @Test fun `avatar url policy accepts only https urls without embedded credentials`() {
        assertEquals("https://images.ihep.ac.cn/a.png", normalizeOidcAvatarUrl(" https://images.ihep.ac.cn/a.png "))
        assertNull(normalizeOidcAvatarUrl("http://images.ihep.ac.cn/a.png"))
        assertNull(normalizeOidcAvatarUrl("https://user:secret@images.ihep.ac.cn/a.png"))
        assertNull(normalizeOidcAvatarUrl("https://images.ihep.ac.cn/a.png#fragment"))
        assertNull(normalizeOidcAvatarUrl("data:image/png;base64,AA=="))
    }

    @Test fun `invalid picture falls back without changing identity`() {
        val user = oidcUser(
            JSONObject("""{"sub":"user-2","email":"user@example.cn","picture":"javascript:alert(1)"}"""),
            JSONObject("""{"sub":"user-2"}"""),
        )
        assertEquals("user@example.cn", user.name)
        assertNull(user.avatarUrl)
        assertEquals("US", userAvatarInitials("User Sample"))
    }
}
