import SwiftUI
import WebKit

// The office's own pages, from the server signed in to, in one web view – as the desktop apps
// show them (`desktop/tabs.mjs`): other sites open in Safari, the camera and microphone only for
// the server, and the page gets `window.sliderInk`, the iPad's handwriting reading.

/// `window.sliderInk` (`apps/web/src/features/pages/lib/ink-read.ts`), answered by the app.
private let inkScript = """
  (() => {
    const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.sliderInk;
    if (!native) return;
    Object.defineProperty(window, 'sliderInk', {
      value: Object.freeze({
        recognize: (lines, languages) => native.postMessage({ lines, languages }),
      }),
    });
  })();
  """

struct OfficeWebView: UIViewRepresentable {
  let account: SignedIn
  let signedOut: () -> Void

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    config.applicationNameForUserAgent = "EigenOffice/1.0"
    let page = WKContentWorld.page
    config.userContentController.addScriptMessageHandler(
      context.coordinator, contentWorld: page, name: "sliderInk")
    config.userContentController.addUserScript(
      WKUserScript(
        source: inkScript, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: page))
    let view = WKWebView(frame: .zero, configuration: config)
    view.navigationDelegate = context.coordinator
    view.uiDelegate = context.coordinator
    view.allowsBackForwardNavigationGestures = false
    #if DEBUG
      view.isInspectable = true
    #endif
    context.coordinator.watch(view)
    Task {
      // The cookie first: the pages open signed in.
      await Session.setCookie(account)
      view.load(URLRequest(url: URL(string: account.server)!))
    }
    return view
  }

  func updateUIView(_ view: WKWebView, context: Context) {}

  final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate,
    WKScriptMessageHandlerWithReply, WKDownloadDelegate
  {
    let parent: OfficeWebView
    private let reader: HandwritingReader = VisionReader()
    private var watching: NSKeyValueObservation?
    private var downloads: [WKDownload: URL] = [:]
    private let origin: URL

    init(_ parent: OfficeWebView) {
      self.parent = parent
      origin = URL(string: parent.account.server)!
    }

    private func isOwn(_ url: URL?) -> Bool {
      guard let url else { return false }
      return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
    }

    /// The pages moved to their login (signed out, the session over): the app signs out too –
    /// its sign-in is the system browser's, never this view's.
    func watch(_ view: WKWebView) {
      watching = view.observe(\.url, options: [.new]) { [weak self] view, _ in
        guard let self, let url = view.url, self.isOwn(url), url.path == "/login" else { return }
        DispatchQueue.main.async { self.parent.signedOut() }
      }
    }

    // MARK: Handwriting

    func userContentController(
      _ controller: WKUserContentController, didReceive message: WKScriptMessage
    ) async -> (Any?, String?) {
      guard message.frameInfo.isMainFrame, isOwn(message.frameInfo.request.url) else {
        return (nil, "Nur für die eigenen Seiten.")
      }
      guard let body = message.body as? [String: Any],
        let raw = body["lines"],
        let data = try? JSONSerialization.data(withJSONObject: raw),
        let lines = try? JSONDecoder().decode([InkLine].self, from: data)
      else { return (nil, "Keine Striche.") }
      let languages = (body["languages"] as? [String]) ?? ["de"]
      do {
        return (try await reader.read(lines, languages: languages), nil)
      } catch {
        return (nil, error.localizedDescription)
      }
    }

    // MARK: Navigation

    func webView(
      _ webView: WKWebView, decidePolicyFor action: WKNavigationAction
    ) async -> WKNavigationActionPolicy {
      guard let url = action.request.url else { return .cancel }
      if action.shouldPerformDownload { return .download }
      if isOwn(url) || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
        return .allow
      }
      // Other sites, mail and phone links: Safari or their app (as the desktop's browser).
      if action.targetFrame?.isMainFrame ?? true, ["https", "http", "mailto", "tel"].contains(url.scheme ?? "") {
        await UIApplication.shared.open(url)
        return .cancel
      }
      return action.targetFrame?.isMainFrame == false ? .allow : .cancel
    }

    func webView(
      _ webView: WKWebView, decidePolicyFor response: WKNavigationResponse
    ) async -> WKNavigationResponsePolicy {
      let disposition = (response.response as? HTTPURLResponse)?
        .value(forHTTPHeaderField: "Content-Disposition") ?? ""
      if !response.canShowMIMEType || disposition.lowercased().hasPrefix("attachment") {
        return .download
      }
      return .allow
    }

    /// A page opening a window (`target=_blank`, presenting): here, if it is the office's.
    func webView(
      _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
      for action: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
      if let url = action.request.url {
        if isOwn(url) { webView.load(action.request) } else { UIApplication.shared.open(url) }
      }
      return nil
    }

    func webView(
      _ webView: WKWebView, decideMediaCapturePermissionsFor origin: WKSecurityOrigin,
      initiatedBy frame: WKFrameInfo, type: WKMediaCaptureType
    ) async -> WKPermissionDecision {
      origin.protocol == self.origin.scheme && origin.host == self.origin.host ? .grant : .deny
    }

    #if DEBUG
      func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Probe.pageLoaded(webView)
      }
    #endif

    /// The page gone (memory): back where it was.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // MARK: Downloads – into the share sheet (save to Files, send on)

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
      download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
      download.delegate = self
    }

    func download(
      _ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String
    ) async -> URL? {
      let folder = FileManager.default.temporaryDirectory.appendingPathComponent(
        UUID().uuidString, isDirectory: true)
      try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      let file = folder.appendingPathComponent(suggestedFilename)
      downloads[download] = file
      return file
    }

    func downloadDidFinish(_ download: WKDownload) {
      guard let file = downloads.removeValue(forKey: download) else { return }
      let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
      guard
        let window = UIApplication.shared.connectedScenes
          .compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first,
        let top = window.rootViewController
      else { return }
      sheet.popoverPresentationController?.sourceView = window
      sheet.popoverPresentationController?.sourceRect = CGRect(
        x: window.bounds.midX, y: window.bounds.midY, width: 0, height: 0)
      sheet.popoverPresentationController?.permittedArrowDirections = []
      top.present(sheet, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
      downloads.removeValue(forKey: download)
    }
  }
}
