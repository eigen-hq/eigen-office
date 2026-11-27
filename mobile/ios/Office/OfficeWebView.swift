import SwiftUI
import WebKit

// The office's own pages, from the server signed in to, in one web view – as the desktop apps
// show them (`desktop/tabs.mjs`): other sites open in Safari, the camera and microphone only for
// the server, and the page gets `window.sliderInk`, the iPad's handwriting reading. The Pencil's
// double tap goes to the page (`sliderpenciltap`); Scribble keeps out where the Pencil draws.

/// `window.sliderInk` (`apps/web/src/features/pages/lib/ink-read.ts`), answered by the app.
private let inkScript = """
  (() => {
    const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.sliderInk;
    if (!native) return;
    Object.defineProperty(window, 'sliderInk', {
      value: Object.freeze({
        recognize: (lines, languages) => native.postMessage({ lines, languages }),
        pencilDraws: (draws) => void native.postMessage({ pencilDraws: !!draws }).catch(() => {}),
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
    let pencil = UIPencilInteraction()
    pencil.delegate = context.coordinator
    view.addInteraction(pencil)
    view.addInteraction(UIScribbleInteraction(delegate: context.coordinator))
    Task {
      // The cookie first: the pages open signed in.
      await Session.setCookie(account)
      view.load(URLRequest(url: URL(string: account.server)!))
    }
    return view
  }

  func updateUIView(_ view: WKWebView, context: Context) {}

  final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate,
    WKScriptMessageHandlerWithReply, WKDownloadDelegate, UIPencilInteractionDelegate,
    UIScribbleInteractionDelegate
  {
    let parent: OfficeWebView
    private let reader: HandwritingReader = VisionReader()
    private var watching: NSKeyValueObservation?
    private var downloads: [WKDownload: URL] = [:]
    private let origin: URL
    private weak var view: WKWebView?
    /// The page says the Pencil draws on it (`pencilDraws`): no Scribble meanwhile.
    private var pencilDraws = false

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
      self.view = view
      watching = view.observe(\.url, options: [.new]) { [weak self] view, _ in
        // Not „Weiteres Konto hinzufügen“ (`/login?add=1`): that is one more account here.
        guard let self, let url = view.url, self.isOwn(url), url.path == "/login",
          !(url.query ?? "").contains("add=1")
        else { return }
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
      guard let body = message.body as? [String: Any] else { return (nil, "Keine Striche.") }
      if let draws = body["pencilDraws"] as? Bool {
        pencilDraws = draws
        #if DEBUG
          print("OFFICE_PENCIL_DRAWS \(draws)")
        #endif
        return (nil, nil)
      }
      guard let raw = body["lines"],
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

    // MARK: Pencil

    /// The double tap, as the iPad is set to answer it (Settings › Apple Pencil): the page's pen
    /// switches (`lib/pen.ts`). A palette the iPad may offer instead is not there.
    func pencilTapped(_ action: UIPencilPreferredAction) {
      let name: String
      switch action {
      case .switchEraser: name = "eraser"
      case .switchPrevious: name = "previous"
      default: return
      }
      view?.evaluateJavaScript(
        "window.dispatchEvent(new CustomEvent('sliderpenciltap', { detail: { action: '\(name)' } }))")
    }

    @available(iOS 17.5, *)
    func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
      pencilTapped(UIPencilInteraction.preferredTapAction)
    }

    /// Before iOS 17.5 only – the newer call above takes its place, never both.
    func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
      if #available(iOS 17.5, *) { return }
      pencilTapped(UIPencilInteraction.preferredTapAction)
    }

    func scribbleInteraction(_ interaction: UIScribbleInteraction, shouldBeginAt location: CGPoint) -> Bool {
      !pencilDraws
    }

    // MARK: Navigation

    /// A new page: it says again whether the Pencil draws on it.
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
      pencilDraws = false
    }

    func webView(
      _ webView: WKWebView, decidePolicyFor action: WKNavigationAction
    ) async -> WKNavigationActionPolicy {
      guard let url = action.request.url else { return .cancel }
      if action.shouldPerformDownload { return .download }
      if isOwn(url) || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
        return .allow
      }
      // Other sites, mail and phone links: Safari or their app (as the desktop's browser).
      if action.targetFrame?.isMainFrame ?? true, Self.leaves(url) {
        await UIApplication.shared.open(url)
        return .cancel
      }
      // A frame in a page (a video, a map) loads the web, never another app's link.
      let web = ["https", "http", "about", "blob", "data"].contains(url.scheme?.lowercased() ?? "")
      return action.targetFrame?.isMainFrame == false && web ? .allow : .cancel
    }

    /// What may leave the app: web pages, mail and phone – no other app's deep link.
    private static func leaves(_ url: URL) -> Bool {
      ["https", "http", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "")
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
        if isOwn(url) { webView.load(action.request) } else if Self.leaves(url) { UIApplication.shared.open(url) }
      }
      return nil
    }

    func webView(
      _ webView: WKWebView, decideMediaCapturePermissionsFor origin: WKSecurityOrigin,
      initiatedBy frame: WKFrameInfo, type: WKMediaCaptureType
    ) async -> WKPermissionDecision {
      // The office's own page only – its main frame, same scheme, host and port (0: the default).
      let own =
        origin.protocol == self.origin.scheme && origin.host == self.origin.host
        && origin.port == (self.origin.port ?? 0)
      return own && frame.isMainFrame && isOwn(frame.request.url) ? .grant : .deny
    }

    #if DEBUG
      func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Probe.pageLoaded(webView)
        Probe.pencilProbe(webView) { self.pencilTapped(.switchEraser) }
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
