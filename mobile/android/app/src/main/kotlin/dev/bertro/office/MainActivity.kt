package dev.bertro.office

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowInsets
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.window.OnBackInvokedDispatcher
import androidx.browser.customtabs.CustomTabsIntent
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

// Eigen Office on an Android tablet: the server's pages (`OfficeWebView`), signed in as the desktop
// apps are (`Session`), with handwriting read on the device (`InkReading`).

class MainActivity : Activity() {
  private val scope = MainScope()
  private lateinit var session: Session
  private lateinit var root: FrameLayout
  private var web: OfficeWebView? = null
  private var message: TextView? = null
  private var busy = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    session = Session(this)
    root = FrameLayout(this)
    // Edge to edge: the bars' room as padding, the keyboard's too.
    root.setOnApplyWindowInsetsListener { view, insets ->
      val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
      val keyboard = insets.getInsets(WindowInsets.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
      WindowInsets.CONSUMED
    }
    setContentView(root)
    if (Build.VERSION.SDK_INT >= 33) {
      onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { back() }
    }
    show()
    take(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    take(intent)
  }

  /** `slider-tablet://auth?code&state` – from the browser. */
  private fun take(intent: Intent?) {
    val link = intent?.data ?: return
    scope.launch {
      try {
        if (session.take(link) != null) show()
      } catch (error: Exception) {
        say(error.message ?: "Die Anmeldung hat nicht geklappt.")
      }
    }
  }

  private fun show() {
    web?.view?.destroy()
    web = null
    message = null
    root.removeAllViews()
    val account = session.signedIn
    if (account != null) {
      val shown = OfficeWebView(this, scope, account) { scope.launch { session.signOut(); show() } }
      web = shown
      root.addView(shown.view, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
      shown.start()
      // The model from Google now, not at the first drawing read (only once per language).
      scope.launch { runCatching { InkReader.fetch(listOf("de")) } }
    } else {
      root.addView(startView())
      if (BuildConfig.DEBUG) Probe.started(this)
    }
  }

  /** Before signing in – as the iPad app's start (`OfficeApp.swift`). */
  private fun startView(): View {
    val dp = { value: Int ->
      TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()
    }
    val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    val gap = { view: View, top: Int ->
      column.addView(view, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(top) })
    }
    gap(TextView(this).apply {
      text = "Eigen Office"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f)
      setTypeface(typeface, android.graphics.Typeface.BOLD)
    }, 0)
    gap(TextView(this).apply {
      text = "Deine Präsentationen, Dateien und Seiten als App. Melde dich an deinem Server an."
      alpha = 0.7f
    }, 12)
    gap(TextView(this).apply { text = "Server" }, 20)
    val field =
      EditText(this).apply {
        setText(session.lastServer)
        hint = "office.bertro.dev"
        isSingleLine = true
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        imeOptions = EditorInfo.IME_ACTION_GO
      }
    gap(field, 4)
    val button = Button(this).apply { text = "Anmelden" }
    gap(button, 12)
    val said = TextView(this)
    gap(said, 12)
    message = said
    val go = { signIn(field.text.toString()) }
    button.setOnClickListener { go() }
    field.setOnEditorActionListener { _, action, _ -> (action == EditorInfo.IME_ACTION_GO).also { if (it) go() } }
    return FrameLayout(this).apply {
      setPadding(dp(24), dp(24), dp(24), dp(24))
      addView(column, FrameLayout.LayoutParams(minOf(dp(420), resources.displayMetrics.widthPixels - dp(48)), WRAP_CONTENT, Gravity.CENTER))
    }
  }

  fun signIn(server: String) {
    if (busy) return
    busy = true
    say("")
    scope.launch {
      try {
        val link = session.begin(server)
        say("Weiter im Browser. Bestätige dort die Anmeldung.")
        if (BuildConfig.DEBUG && Probe.noBrowser(this@MainActivity)) Probe.signInLink(link)
        else CustomTabsIntent.Builder().build().launchUrl(this@MainActivity, link)
      } catch (error: Exception) {
        say(error.message ?: "Die Anmeldung hat nicht geklappt.")
      } finally {
        busy = false
      }
    }
  }

  private fun say(text: String) {
    message?.text = text
  }

  private fun back() {
    val view = web?.view
    if (view != null && view.canGoBack()) view.goBack() else finish()
  }

  @Deprecated("Below Android 13 only; above, OnBackInvokedDispatcher.")
  override fun onBackPressed() {
    back()
  }

  @Deprecated("The web view's file picker.")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    web?.onActivityResult(requestCode, resultCode, data)
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, results)
    web?.onPermissionsResult(requestCode, results)
  }

  override fun onDestroy() {
    web?.view?.destroy()
    scope.cancel()
    super.onDestroy()
  }
}
