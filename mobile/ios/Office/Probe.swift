#if DEBUG
  import Foundation
  import WebKit

  /// Switches for trying the app in the simulator (environment, `simctl launch`): never in a
  /// release build.
  enum Probe {
    private static let env = ProcessInfo.processInfo.environment
    /// `OFFICE_SIGN_IN_TO`: sign in to this server at start.
    static let signInTo = env["OFFICE_SIGN_IN_TO"]
    /// `OFFICE_NO_BROWSER`: print the sign-in link instead of opening it.
    static let noBrowser = env["OFFICE_NO_BROWSER"] != nil
    /// `OFFICE_CALLBACK_FILE`: the `slider-tablet://auth` link, once written there (the
    /// simulator asks before opening a scheme, and no test can tap).
    static let callbackFile = env["OFFICE_CALLBACK_FILE"]
    /// `OFFICE_INK_PROBE`: a JSON file of lines – asked of `window.sliderInk` once a page loads.
    static let inkProbe = env["OFFICE_INK_PROBE"]

    /// `OFFICE_COOKIE_PROBE`: the session cookie as an https server gets it, printed.
    static func cookieProbe() async {
      guard env["OFFICE_COOKIE_PROBE"] != nil else { return }
      await Session.setCookie(SignedIn(server: "https://office.example", token: "probe"))
      for cookie in await WKWebsiteDataStore.default().httpCookieStore.allCookies()
      where cookie.domain.contains("office.example") {
        print("OFFICE_HTTPS_COOKIE \(cookie.name) secure=\(cookie.isSecure) httpOnly=\(cookie.isHTTPOnly) path=\(cookie.path) domain=\(cookie.domain) sameSite=\(cookie.sameSitePolicy?.rawValue ?? "-")")
      }
    }

    @MainActor static func waitForCallback(_ session: Session) async {
      guard let path = callbackFile else { return }
      for _ in 0..<240 {
        if let text = try? String(contentsOfFile: path, encoding: .utf8),
          let link = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines))
        {
          do { try await session.take(link) } catch { print("OFFICE_SIGN_IN_ERROR \(error)") }
          return
        }
        try? await Task.sleep(for: .milliseconds(500))
      }
    }

    /// `OFFICE_SIGN_OUT_PROBE`: after the handwriting, the page goes to its login.
    static let signOutProbe = env["OFFICE_SIGN_OUT_PROBE"] != nil

    /// `OFFICE_OPEN=<path>`: from the start page on to this one (a page of the office).
    static let openPath = env["OFFICE_OPEN"]

    @MainActor static func pageLoaded(_ view: WKWebView) {
      print("OFFICE_PAGE \(view.url?.absoluteString ?? "")")
      if let path = openPath, view.url?.path == "/" {
        view.evaluateJavaScript("location.assign(\(String(reflecting: path)))")
      }
      // `OFFICE_FOCUS_PROBE`: a field of the page focused, then left (Scribble there, not drawing).
      if env["OFFICE_FOCUS_PROBE"] != nil, view.url?.path != "/" {
        view.evaluateJavaScript(
          "setTimeout(() => { const f = document.querySelector('textarea, input:not([type=hidden])'); f?.focus(); console.log(!!f); setTimeout(() => f?.blur(), 1500) }, 3000)")
      }
      view.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
        print("OFFICE_COOKIES \(cookies.map { "\($0.name) httpOnly=\($0.isHTTPOnly)" })")
      }
      guard let path = inkProbe, let lines = try? String(contentsOfFile: path, encoding: .utf8)
      else { return }
      view.callAsyncJavaScript(
        "return JSON.stringify(await window.sliderInk.recognize(JSON.parse(lines), ['de']))",
        arguments: ["lines": lines], in: nil, in: .page
      ) { result in
        switch result {
        case .success(let said):
          print("OFFICE_INK \(said)")
          if signOutProbe { view.evaluateJavaScript("location.assign('/login')") }
        case .failure(let error): print("OFFICE_INK_ERROR \(error)")
        }
      }
    }

    /// `OFFICE_PENCIL_PROBE`: the Pencil's double tap (eraser) once the page loads – the page
    /// tells whether it heard it (`OFFICE_PENCIL_TAP`).
    @MainActor static func pencilProbe(_ view: WKWebView, tap: @escaping () -> Void) {
      guard env["OFFICE_PENCIL_PROBE"] != nil else { return }
      view.evaluateJavaScript(
        "window.addEventListener('sliderpenciltap', (e) => window.webkit.messageHandlers.sliderInk.postMessage({ pencilDraws: e.detail.action === 'eraser' }), { once: true })"
      ) { _, _ in
        print("OFFICE_PENCIL_TAP sent")
        tap()
      }
    }
  }
#endif
