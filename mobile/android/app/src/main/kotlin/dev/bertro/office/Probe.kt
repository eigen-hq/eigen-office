package dev.bertro.office

import android.app.Activity
import android.net.Uri
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebView
import java.io.File
import org.json.JSONObject

// Trying the app on the emulator (DEBUG builds only): switches as intent extras of
// `adb shell am start -n dev.bertro.office/.MainActivity --es … …`, answers in logcat (`OFFICE`).
// The code comes back with `adb shell am start -a android.intent.action.VIEW -d 'slider-tablet://auth?…'`.

object Probe {
  private fun extra(activity: Activity, name: String) = activity.intent?.getStringExtra(name)

  /** `--es signInTo <server>`: signs in at once from the start screen. */
  fun started(activity: MainActivity) {
    Log.i(OfficeWebView.TAG, "OFFICE_START")
    extra(activity, "signInTo")?.let { activity.signIn(it) }
  }

  /** `--es noBrowser 1`: the login's link in logcat instead of the browser. */
  fun noBrowser(activity: Activity) = extra(activity, "noBrowser") != null

  fun signInLink(link: Uri) = Log.i(OfficeWebView.TAG, "OFFICE_SIGN_IN $link")

  /**
   * Each page loaded: its address and the session cookie's name. `--es inkProbe <file in the app's
   * files>` asks `window.sliderInk` with its lines; `--es signOutProbe 1` then goes to `/login`;
   * `--es open <path>` goes on to that page.
   */
  fun pageLoaded(activity: Activity, view: WebView, url: String, server: String) {
    Log.i(OfficeWebView.TAG, "OFFICE_PAGE $url")
    val names = CookieManager.getInstance().getCookie(server)?.split("; ")?.map { it.substringBefore('=') }
    Log.i(OfficeWebView.TAG, "OFFICE_COOKIES $names")
    extra(activity, "open")?.let { path ->
      if (Uri.parse(url).path == "/") view.evaluateJavascript("location.assign(${JSONObject.quote(path)})", null)
    }
    if (Uri.parse(url).path != "/") return
    // `--es js <file in the app's files>`: its script runs on the start page (a download …).
    // A moment after the start page settled – each time it loads (the script runs once itself).
    extra(activity, "js")?.let {
      val script = File(activity.filesDir, it).readText()
      view.postDelayed({ view.evaluateJavascript(script, null) }, 4000)
    }
    val probe = extra(activity, "inkProbe") ?: return
    val lines = File(activity.filesDir, probe).readText()
    val then = if (extra(activity, "signOutProbe") != null) "location.assign('/login')" else ""
    view.evaluateJavascript(
      """
      window.sliderInk.recognize($lines, ['de']).then(
        (said) => { console.log('OFFICE_INK ' + JSON.stringify(said)); $then },
        (error) => console.log('OFFICE_INK_ERROR ' + error.message),
      )
      """,
      null,
    )
  }
}
