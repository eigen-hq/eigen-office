package dev.bertro.office

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.CookieManager
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject

// Signing in as the desktop apps and the iPad app do (`desktop/cloud/main.mjs`,
// `mobile/ios/Office/Session.swift`): the server's own login in the browser
// (`/desktop-anmelden?app=tablet`, a Custom Tab), a one-time code back through
// `slider-tablet://auth`, traded for a token (PKCE) that becomes the web view's session cookie.
// The token is kept encrypted with a key of the Android Keystore.

/** The hosted office – as `HOSTED_URL` in `packages/shared/src/desktop.ts`. */
const val HOSTED_SERVER = "https://office.bertro.dev"
const val CALLBACK_SCHEME = "slider-tablet"

data class SignedIn(val server: String, val token: String)

class SignInError(message: String) : Exception(message)

/** Origin only, https unless this machine – as the desktop apps' „Server“. */
fun serverOf(text: String): String {
  val raw = text.trim()
  val full =
    if (raw.startsWith("http://", true) || raw.startsWith("https://", true)) raw
    else "https://${raw.ifEmpty { HOSTED_SERVER }}"
  val url = runCatching { Uri.parse(full) }.getOrNull()
  val host = url?.host
  val scheme = url?.scheme?.lowercase()
  if (url == null || host.isNullOrEmpty() || scheme == null) {
    throw SignInError("Das ist keine Adresse.")
  }
  val local = host in setOf("localhost", "127.0.0.1", "::1")
  if (scheme != "https" && !local) throw SignInError("Der Server braucht https.")
  // Lower case: the web view's origins are, `isOwn` compares them as they are.
  return "$scheme://${host.lowercase()}${if (url.port != -1) ":${url.port}" else ""}"
}

private fun base64url(bytes: ByteArray) =
  Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

private fun randomText(bytes: Int) = base64url(ByteArray(bytes).also { SecureRandom().nextBytes(it) })

class Session(private val context: Context) {
  private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)

  var signedIn: SignedIn? = Vault.load(prefs)
    private set

  /** The server last signed in to – the field's text next time. */
  val lastServer: String
    get() = prefs.getString("server", null) ?: HOSTED_SERVER

  /**
   * The link to the server's login, the verifier and state kept on disk – Android may end the app
   * while the browser is in front.
   */
  suspend fun begin(serverText: String): Uri {
    val server = serverOf(serverText)
    if (!answers(server)) throw SignInError("Unter dieser Adresse antwortet kein Server.")
    val verifier = randomText(32)
    val state = randomText(16)
    prefs
      .edit()
      .putString("pendingServer", server)
      .putString("pendingVerifier", verifier)
      .putString("pendingState", state)
      .apply()
    val challenge =
      base64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.UTF_8)))
    return Uri.parse("$server/desktop-anmelden")
      .buildUpon()
      .appendQueryParameter("challenge", challenge)
      .appendQueryParameter("state", state)
      .appendQueryParameter("app", "tablet")
      .build()
  }

  /** `slider-tablet://auth?code&state` – back from the browser. `null`: not ours. */
  suspend fun take(link: Uri): SignedIn? {
    if (link.scheme != CALLBACK_SCHEME || link.host != "auth") return null
    val server = prefs.getString("pendingServer", null) ?: return null
    val verifier = prefs.getString("pendingVerifier", null) ?: return null
    val code = link.getQueryParameter("code") ?: return null
    if (link.getQueryParameter("state") != prefs.getString("pendingState", null)) return null
    prefs.edit().remove("pendingServer").remove("pendingVerifier").remove("pendingState").apply()
    val (status, answer) =
      post("$server/api/auth/desktop/token", JSONObject().put("code", code).put("verifier", verifier))
    val token = answer?.optString("token")?.takeIf { status == 200 && it.isNotEmpty() }
    if (token == null) {
      val message = answer?.optJSONObject("error")?.optString("message")?.takeIf { it.isNotEmpty() }
      throw SignInError(message ?: "Die Anmeldung hat nicht geklappt.")
    }
    val account = SignedIn(server, token)
    setCookie(account)
    Vault.save(prefs, account)
    prefs.edit().putString("server", server).apply()
    signedIn = account
    return account
  }

  /** The pages signed out (or the session ended): the app's token goes too. */
  suspend fun signOut() {
    val account = signedIn ?: return
    signedIn = null
    Vault.save(prefs, null)
    runCatching { post("${account.server}/api/auth/desktop/logout", JSONObject().put("token", account.token)) }
    val cookies = CookieManager.getInstance()
    for (gone in listOf(
      "__Host-slider_session=; Path=/; Secure; Max-Age=0",
      "slider_session=; Path=/; Max-Age=0",
    )) {
      suspendCancellableCoroutine { done -> cookies.setCookie(account.server, gone) { done.resume(Unit) } }
    }
    cookies.flush()
  }

  private suspend fun answers(server: String): Boolean =
    withContext(Dispatchers.IO) {
      runCatching {
          val connection = URL("$server/api/health").openConnection() as HttpURLConnection
          connection.connectTimeout = 8000
          connection.readTimeout = 8000
          connection.responseCode == 200 &&
            JSONObject(connection.inputStream.bufferedReader().readText()).optBoolean("ok")
        }
        .getOrDefault(false)
    }

  private suspend fun post(url: String, body: JSONObject): Pair<Int, JSONObject?> =
    withContext(Dispatchers.IO) {
      val connection = URL(url).openConnection() as HttpURLConnection
      connection.requestMethod = "POST"
      connection.connectTimeout = 15000
      connection.readTimeout = 15000
      connection.doOutput = true
      connection.setRequestProperty("content-type", "application/json")
      connection.outputStream.use { it.write(body.toString().toByteArray()) }
      val status = connection.responseCode
      val text = (if (status < 400) connection.inputStream else connection.errorStream)
        ?.bufferedReader()
        ?.readText()
      status to text?.let { runCatching { JSONObject(it) }.getOrNull() }
    }

  companion object {
    /** The token as the server's own session cookie (`apps/api/src/auth/cookies.ts`). */
    suspend fun setCookie(account: SignedIn) {
      val secure = account.server.startsWith("https://")
      val cookie =
        if (secure) "__Host-slider_session=${account.token}; Path=/; Secure; HttpOnly; SameSite=Lax"
        else "slider_session=${account.token}; Path=/; HttpOnly; SameSite=Lax"
      val cookies = CookieManager.getInstance()
      suspendCancellableCoroutine { done -> cookies.setCookie(account.server, cookie) { done.resume(Unit) } }
      cookies.flush()
    }
  }
}

/** The signed-in account, encrypted with a key that never leaves this device's Keystore. */
private object Vault {
  private const val KEY = "dev.bertro.office.session"

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(KEY, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .build()
    )
    return generator.generateKey()
  }

  fun load(prefs: android.content.SharedPreferences): SignedIn? =
    runCatching {
        val sealed = Base64.decode(prefs.getString("account", null) ?: return null, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, 12))
        val json = JSONObject(String(cipher.doFinal(sealed, 12, sealed.size - 12)))
        SignedIn(json.getString("server"), json.getString("token"))
      }
      .getOrNull()

  fun save(prefs: android.content.SharedPreferences, account: SignedIn?) {
    if (account == null) {
      prefs.edit().remove("account").apply()
      return
    }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val plain = JSONObject().put("server", account.server).put("token", account.token).toString()
    val sealed = cipher.iv + cipher.doFinal(plain.toByteArray())
    prefs.edit().putString("account", Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
  }
}
