import SwiftUI

// Eigen Office on the iPad: the server's pages (`OfficeWebView`), signed in as the desktop apps
// are (`Session`), with handwriting read on the device (`InkReading`).

@main
struct OfficeApp: App {
  @StateObject private var session = Session()

  var body: some Scene {
    WindowGroup {
      Group {
        if let account = session.signedIn {
          OfficeWebView(account: account) { Task { await session.signedOut() } }
            .id(account.token)
            .ignoresSafeArea(.container, edges: .bottom)
        } else {
          StartView(session: session)
            #if DEBUG
              .onAppear { print("OFFICE_START") }
              .task {
                guard let server = Probe.signInTo else { return }
                session.serverText = server
                await session.signIn()
                await Probe.waitForCallback(session)
              }
            #endif
        }
      }
      .onOpenURL { link in
        Task {
          do { try await session.take(link) } catch { session.message = error.localizedDescription }
        }
      }
    }
  }
}

/// Before signing in – as the desktop apps' start (`desktop/cloud/start.html`).
struct StartView: View {
  @ObservedObject var session: Session

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text("Eigen Office").font(.largeTitle.weight(.semibold))
      Text("Deine Präsentationen, Dateien und Seiten als App. Melde dich an deinem Server an.")
        .foregroundStyle(.secondary)
      VStack(alignment: .leading, spacing: 6) {
        Text("Server").font(.subheadline.weight(.medium))
        TextField("office.bertro.dev", text: $session.serverText)
          .textFieldStyle(.roundedBorder)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.URL)
          .submitLabel(.go)
          .onSubmit { Task { await session.signIn() } }
      }
      Button {
        Task { await session.signIn() }
      } label: {
        Text("Anmelden").frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .controlSize(.large)
      .disabled(session.busy)
      Text(session.message)
        .font(.callout)
        .frame(minHeight: 20, alignment: .topLeading)
    }
    .frame(maxWidth: 420)
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
