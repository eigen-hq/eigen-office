import AuthenticationServices
import CryptoKit
import Foundation
import Security
import WebKit

// Signing in as the desktop apps do (`desktop/cloud/main.mjs`, `packages/shared/src/desktop.ts`):
// the server's own login in the system browser (`/desktop-anmelden?app=tablet`), a one-time code
// back through `slider-tablet://auth`, traded for a token (PKCE) that becomes the web view's
// session cookie. The token is kept in the keychain.

/// The hosted office – as `HOSTED_URL` in `packages/shared/src/desktop.ts`.
let hostedServer = "https://office.bertro.dev"
let callbackScheme = "slider-tablet"

struct SignedIn: Codable, Equatable {
  let server: String
  let token: String
}

enum SignInError: LocalizedError {
  case message(String)
  var errorDescription: String? {
    if case .message(let text) = self { return text }
    return nil
  }
}

/// Origin only, https unless this machine – as the desktop apps' „Server“.
func serverOf(_ text: String) throws -> String {
  let raw = text.trimmingCharacters(in: .whitespaces)
  let full = raw.lowercased().hasPrefix("http://") || raw.lowercased().hasPrefix("https://")
    ? raw : "https://\(raw.isEmpty ? hostedServer : raw)"
  guard let url = URL(string: full), let host = url.host, let scheme = url.scheme else {
    throw SignInError.message("Das ist keine Adresse.")
  }
  let local = ["localhost", "127.0.0.1", "::1"].contains(host)
  if scheme != "https" && !local { throw SignInError.message("Der Server braucht https.") }
  return "\(scheme)://\(host)\(url.port.map { ":\($0)" } ?? "")"
}

private func base64url(_ data: Data) -> String {
  data.base64EncodedString()
    .replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

private func randomText(_ bytes: Int) -> String {
  var data = Data(count: bytes)
  _ = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!) }
  return base64url(data)
}

@MainActor
final class Session: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
  @Published private(set) var signedIn: SignedIn?
  @Published private(set) var busy = false
  @Published var message = ""
  /// The server last signed in to – the field's text next time.
  @Published var serverText: String

  private var pending: (server: String, verifier: String, state: String)?
  private var authSession: ASWebAuthenticationSession?

  override init() {
    signedIn = Keychain.load()
    serverText = UserDefaults.standard.string(forKey: "server") ?? hostedServer
    super.init()
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    UIApplication.shared.connectedScenes
      .compactMap { ($0 as? UIWindowScene)?.keyWindow }
      .first ?? ASPresentationAnchor()
  }

  func signIn() async {
    guard !busy else { return }
    busy = true
    message = ""
    defer { busy = false }
    do {
      let server = try serverOf(serverText)
      guard await Self.answers(server) else {
        throw SignInError.message("Unter dieser Adresse antwortet kein Server.")
      }
      let verifier = randomText(32)
      let state = randomText(16)
      pending = (server, verifier, state)
      var query = URLComponents(string: "\(server)/desktop-anmelden")!
      query.queryItems = [
        URLQueryItem(
          name: "challenge", value: base64url(Data(SHA256.hash(data: Data(verifier.utf8))))),
        URLQueryItem(name: "state", value: state),
        URLQueryItem(name: "app", value: "tablet"),
      ]
      message = "Weiter im Browser. Bestätige dort die Anmeldung."
      #if DEBUG
        // Tests follow the link themselves (as the desktop apps' `CLOUD_NO_BROWSER`).
        if Probe.noBrowser {
          print("OFFICE_SIGN_IN \(query.url!.absoluteString)")
          return
        }
      #endif
      let link = try await browse(query.url!)
      try await take(link)
    } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
      message = ""
    } catch {
      message = error.localizedDescription
    }
  }

  /// The server's login in the system browser (Safari's sign-ins), until it hands back the code.
  private func browse(_ url: URL) async throws -> URL {
    try await withCheckedThrowingContinuation { done in
      let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) {
        link, error in
        if let link { done.resume(returning: link) } else {
          done.resume(throwing: error ?? SignInError.message("Die Anmeldung hat nicht geklappt."))
        }
      }
      session.presentationContextProvider = self
      session.prefersEphemeralWebBrowserSession = false
      authSession = session
      if !session.start() {
        done.resume(throwing: SignInError.message("Der Browser ließ sich nicht öffnen."))
      }
    }
  }

  /// `slider-tablet://auth?code&state` – from the browser sheet, or opened from outside.
  func take(_ link: URL) async throws {
    guard link.scheme == callbackScheme, link.host == "auth" else { return }
    let items = URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems ?? []
    let value = { (name: String) in items.first { $0.name == name }?.value }
    guard let pending, let code = value("code"), value("state") == pending.state else { return }
    self.pending = nil
    var request = URLRequest(url: URL(string: "\(pending.server)/api/auth/desktop/token")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "code": code, "verifier": pending.verifier,
    ])
    request.timeoutInterval = 15
    let (data, response) = try await URLSession.shared.data(for: request)
    let answer = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    guard (response as? HTTPURLResponse)?.statusCode == 200, let token = answer?["token"] as? String
    else {
      let error = (answer?["error"] as? [String: Any])?["message"] as? String
      throw SignInError.message(error ?? "Die Anmeldung hat nicht geklappt.")
    }
    let account = SignedIn(server: pending.server, token: token)
    await Self.setCookie(account)
    Keychain.save(account)
    UserDefaults.standard.set(pending.server, forKey: "server")
    message = ""
    signedIn = account
  }

  /// The token as the server's own session cookie (`apps/api/src/auth/cookies.ts`).
  static func setCookie(_ account: SignedIn) async {
    guard let url = URL(string: account.server), let host = url.host else { return }
    let secure = url.scheme == "https"
    var properties: [HTTPCookiePropertyKey: Any] = [
      .name: secure ? "__Host-slider_session" : "slider_session",
      .value: account.token,
      .path: "/",
      .originURL: url,
      .domain: host,
      .sameSitePolicy: HTTPCookieStringPolicy.sameSiteLax.rawValue,
      HTTPCookiePropertyKey("HttpOnly"): "TRUE",
    ]
    if secure { properties[.secure] = "TRUE" }
    if let cookie = HTTPCookie(properties: properties) {
      await WKWebsiteDataStore.default().httpCookieStore.setCookie(cookie)
    }
  }

  /// The pages signed out (or the session ended): the app's token goes too.
  func signedOut() async {
    guard let account = signedIn else { return }
    signedIn = nil
    Keychain.save(nil)
    var request = URLRequest(url: URL(string: "\(account.server)/api/auth/desktop/logout")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["token": account.token])
    request.timeoutInterval = 8
    _ = try? await URLSession.shared.data(for: request)
    let store = WKWebsiteDataStore.default().httpCookieStore
    for cookie in await store.allCookies() where cookie.name.hasSuffix("slider_session") {
      await store.deleteCookie(cookie)
    }
  }

  private static func answers(_ server: String) async -> Bool {
    guard let url = URL(string: "\(server)/api/health") else { return false }
    var request = URLRequest(url: url)
    request.timeoutInterval = 8
    guard let (data, response) = try? await URLSession.shared.data(for: request),
      (response as? HTTPURLResponse)?.statusCode == 200,
      let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return false }
    return body["ok"] as? Bool == true
  }
}

/// The signed-in account, in the keychain (this device only).
enum Keychain {
  private static let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "dev.bertro.office.session",
  ]

  static func load() -> SignedIn? {
    var item: AnyObject?
    var ask = query
    ask[kSecReturnData as String] = true
    guard SecItemCopyMatching(ask as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data
    else { return nil }
    return try? JSONDecoder().decode(SignedIn.self, from: data)
  }

  static func save(_ account: SignedIn?) {
    SecItemDelete(query as CFDictionary)
    guard let account, let data = try? JSONEncoder().encode(account) else { return }
    var add = query
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(add as CFDictionary, nil)
    #if DEBUG
      print("OFFICE_KEYCHAIN \(status)")
    #endif
  }
}
