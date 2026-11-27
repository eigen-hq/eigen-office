package dev.bertro.office

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

// The office's own pages, from the server signed in to, in one web view – as the iPad app
// (`mobile/ios/Office/OfficeWebView.swift`) and the desktop apps show them: other sites open in
// the browser, the camera and microphone only for the server, and the page gets
// `window.sliderInk`, the tablet's handwriting reading (ML Kit, `InkReading.kt`).

/**
 * `window.sliderInk` (`apps/web/src/features/pages/lib/ink-read.ts`), answered by the app through
 * `sliderInkNative` – a message channel only the server's own pages get.
 */
private const val INK_SCRIPT =
  """
(() => {
  const native = window.sliderInkNative;
  if (!native || window.sliderInk) return;
  const waiting = new Map();
  let next = 0;
  native.onmessage = (event) => {
    const answer = JSON.parse(event.data);
    const asked = waiting.get(answer.id);
    if (!asked) return;
    waiting.delete(answer.id);
    if (answer.error) asked.reject(new Error(answer.error));
    else asked.resolve(answer.said);
  };
  const ask = (message) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      waiting.set(id, { resolve, reject });
      native.postMessage(JSON.stringify({ ...message, id }));
    });
  Object.defineProperty(window, 'sliderInk', {
    value: Object.freeze({ recognize: (lines, languages) => ask({ lines, languages }) }),
  });
  // A download the page made itself (blob:) – the app saves it, as the browser would.
  window.sliderSaveBlob = async (url, name) => {
    const blob = await (await fetch(url)).blob();
    const data = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.readAsDataURL(blob);
    });
    native.postMessage(JSON.stringify({ save: { name, type: blob.type, data } }));
  };
  // Its name is the link's `download` – the download listener only sees the blob's id.
  const saved = (link) => {
    if (!link || !link.download || !String(link.href).startsWith('blob:')) return false;
    window.sliderSaveBlob(link.href, link.download);
    return true;
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!saved(this)) click.call(this);
  };
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[download]') : null;
      if (saved(link)) event.preventDefault();
    },
    true,
  );
})();
"""

class OfficeWebView(
  private val activity: Activity,
  private val scope: CoroutineScope,
  private val account: SignedIn,
  private val signedOut: () -> Unit,
) {
  private val origin: Uri = Uri.parse(account.server)
  private val originRule = account.server
  private var filePick: ValueCallback<Array<Uri>>? = null
  private var mediaAsk: PermissionRequest? = null
  val view: WebView = WebView(activity)

  private fun isOwn(url: Uri?) =
    url != null && url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port

  @SuppressLint("SetJavaScriptEnabled")
  fun start() {
    view.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      mediaPlaybackRequiresUserGesture = false
      setSupportMultipleWindows(false)
      userAgentString = "$userAgentString EigenOffice/1.0"
    }
    CookieManager.getInstance().setAcceptCookie(true)
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    bridge()
    view.webViewClient = Pages()
    view.webChromeClient = Chrome()
    view.setDownloadListener { url, userAgent, disposition, type, _ -> download(url, userAgent, disposition, type) }
    scope.launch {
      // The cookie first: the pages open signed in.
      Session.setCookie(account)
      view.loadUrl(account.server)
    }
  }

  // MARK: Handwriting

  private fun bridge() {
    if (
      !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
        !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    ) {
      Log.w(TAG, "This WebView cannot carry window.sliderInk – handwriting stays unread.")
      return
    }
    WebViewCompat.addWebMessageListener(view, "sliderInkNative", setOf(originRule)) {
      _,
      message,
      source,
      isMainFrame,
      reply ->
      if (isMainFrame && isOwn(source)) answer(message, reply)
    }
    WebViewCompat.addDocumentStartJavaScript(view, INK_SCRIPT, setOf(originRule))
  }

  private fun answer(message: WebMessageCompat, reply: JavaScriptReplyProxy) {
    val body = runCatching { JSONObject(message.data ?: "") }.getOrNull() ?: return
    body.optJSONObject("save")?.let {
      save(it)
      return
    }
    val id = body.optInt("id")
    scope.launch {
      val answer = JSONObject().put("id", id)
      try {
        val lines = parseLines(body.getJSONArray("lines"))
        val languages = body.optJSONArray("languages")?.let { list -> (0 until list.length()).map { list.getString(it) } }
        answer.put("said", JSONArray(InkReader.read(lines, languages ?: listOf("de"))))
      } catch (error: ReadError) {
        answer.put("error", error.message)
      } catch (error: Exception) {
        answer.put("error", "Die Handschrift ließ sich nicht lesen.")
      }
      reply.postMessage(answer.toString())
    }
  }

  // MARK: Navigation

  private inner class Pages : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
      val url = request.url
      if (isOwn(url) || url.scheme in setOf("about", "blob", "data")) return false
      if (!request.isForMainFrame) return false
      // Other sites, mail and phone links: the browser or their app (as the desktop's browser).
      if (url.scheme in setOf("https", "http", "mailto", "tel")) open(url)
      return true
    }

    /** The pages moved to their login (signed out, the session over): the app signs out too. */
    override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
      val page = Uri.parse(url)
      // Not „Weiteres Konto hinzufügen“ (`/login?add=1`): that is one more account here.
      if (isOwn(page) && page.path == "/login" && page.getQueryParameter("add") != "1") signedOut()
    }

    override fun onPageFinished(view: WebView, url: String) {
      if (BuildConfig.DEBUG) Probe.pageLoaded(activity, view, url, account.server)
    }

    /** The page gone (memory): back where it was. */
    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
      activity.recreate()
      return true
    }
  }

  private fun open(url: Uri) {
    try {
      activity.startActivity(Intent(Intent.ACTION_VIEW, url))
    } catch (_: ActivityNotFoundException) {
      Toast.makeText(activity, "Keine App öffnet diesen Link.", Toast.LENGTH_SHORT).show()
    }
  }

  // MARK: Files, camera and microphone

  private inner class Chrome : WebChromeClient() {
    override fun onConsoleMessage(message: android.webkit.ConsoleMessage): Boolean {
      if (BuildConfig.DEBUG && message.message().startsWith("OFFICE_")) Log.i(TAG, message.message())
      return false
    }

    override fun onShowFileChooser(
      view: WebView,
      callback: ValueCallback<Array<Uri>>,
      params: FileChooserParams,
    ): Boolean {
      filePick?.onReceiveValue(null)
      filePick = callback
      return try {
        activity.startActivityForResult(params.createIntent(), PICK_FILES)
        true
      } catch (_: ActivityNotFoundException) {
        filePick = null
        false
      }
    }

    override fun onPermissionRequest(request: PermissionRequest) {
      if (!isOwn(request.origin)) return request.deny()
      val needed =
        request.resources.flatMap {
          when (it) {
            PermissionRequest.RESOURCE_VIDEO_CAPTURE -> listOf(Manifest.permission.CAMERA)
            PermissionRequest.RESOURCE_AUDIO_CAPTURE -> listOf(Manifest.permission.RECORD_AUDIO)
            else -> emptyList()
          }
        }
      val missing = needed.filter { activity.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
      if (missing.isEmpty()) return request.grant(request.resources)
      mediaAsk = request
      activity.requestPermissions(missing.toTypedArray(), ASK_MEDIA)
    }
  }

  fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != PICK_FILES) return
    filePick?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
    filePick = null
  }

  fun onPermissionsResult(requestCode: Int, results: IntArray) {
    if (requestCode != ASK_MEDIA) return
    val asked = mediaAsk ?: return
    mediaAsk = null
    if (results.isNotEmpty() && results.all { it == PackageManager.PERMISSION_GRANTED }) {
      asked.grant(asked.resources)
    } else {
      asked.deny()
    }
  }

  // MARK: Downloads – into Downloads, as the browser does

  private fun download(url: String, userAgent: String, disposition: String?, type: String?) {
    val name = nameOf(disposition) ?: URLUtil.guessFileName(url, disposition, type)
    if (BuildConfig.DEBUG) Log.i(TAG, "OFFICE_DOWNLOAD $name ${url.take(60)}")
    if (url.startsWith("blob:")) {
      view.evaluateJavascript("window.sliderSaveBlob?.(${JSONObject.quote(url)}, ${JSONObject.quote(name)})", null)
      return
    }
    val uri = Uri.parse(url)
    if (!isOwn(uri)) return open(uri)
    val request =
      DownloadManager.Request(uri)
        .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
        .addRequestHeader("User-Agent", userAgent)
        .setMimeType(type)
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
    activity.getSystemService(DownloadManager::class.java).enqueue(request)
    Toast.makeText(activity, "„$name“ wird geladen.", Toast.LENGTH_SHORT).show()
  }

  /** The server's `Content-Disposition` name (`filename*` first) – Android's own guess misses it. */
  private fun nameOf(disposition: String?): String? {
    if (disposition == null) return null
    Regex("filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE).find(disposition)?.let {
      return Uri.decode(it.groupValues[1].trim())
    }
    return Regex("filename=\"([^\"]+)\"", RegexOption.IGNORE_CASE).find(disposition)?.groupValues?.get(1)
  }

  private fun save(file: JSONObject) {
    val name = file.optString("name").ifEmpty { "Download" }
    val values =
      ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, name)
        put(MediaStore.Downloads.MIME_TYPE, file.optString("type").ifEmpty { "application/octet-stream" })
      }
    val resolver = activity.contentResolver
    val saved =
      runCatching {
          val target = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)!!
          resolver.openOutputStream(target)!!.use { it.write(Base64.decode(file.getString("data"), Base64.DEFAULT)) }
        }
        .isSuccess
    activity.runOnUiThread {
      Toast.makeText(
          activity,
          if (saved) "„$name“ liegt in Downloads." else "„$name“ ließ sich nicht speichern.",
          Toast.LENGTH_SHORT,
        )
        .show()
    }
  }

  companion object {
    const val TAG = "OFFICE"
    const val PICK_FILES = 1
    const val ASK_MEDIA = 2
  }
}
