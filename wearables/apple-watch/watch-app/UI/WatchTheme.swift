import SwiftUI

enum WatchTheme {
  static let background = Color(red: 31 / 255, green: 19 / 255, blue: 8 / 255)
  static let surface = Color(red: 43 / 255, green: 26 / 255, blue: 14 / 255)
  static let raised = Color(red: 58 / 255, green: 37 / 255, blue: 21 / 255)
  static let border = Color(red: 90 / 255, green: 58 / 255, blue: 32 / 255)
  static let amber = Color(red: 232 / 255, green: 163 / 255, blue: 23 / 255)
  static let amberSoft = Color(red: 245 / 255, green: 182 / 255, blue: 66 / 255)
  static let glow = Color(red: 255 / 255, green: 122 / 255, blue: 26 / 255)
  static let neon = Color(red: 255 / 255, green: 210 / 255, blue: 122 / 255)
  static let cream = Color(red: 251 / 255, green: 243 / 255, blue: 224 / 255)
  static let creamMuted = Color(red: 232 / 255, green: 220 / 255, blue: 192 / 255)
  static let muted = Color(red: 168 / 255, green: 137 / 255, blue: 106 / 255)
  static let success = Color(red: 125 / 255, green: 214 / 255, blue: 107 / 255)
  static let warning = amberSoft
  static let cardRadius: CGFloat = 22
}

struct WatchCard<Content: View>: View {
  let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    content
      .padding(10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        WatchTheme.surface,
        in: RoundedRectangle(cornerRadius: WatchTheme.cardRadius, style: .continuous)
      )
      .overlay {
        RoundedRectangle(cornerRadius: WatchTheme.cardRadius, style: .continuous)
          .stroke(WatchTheme.cream.opacity(0.07), lineWidth: 1)
      }
      .overlay(alignment: .top) {
        Capsule()
          .fill(WatchTheme.cream.opacity(0.22))
          .frame(height: 1)
          .padding(.horizontal, 22)
      }
      .shadow(color: Color.black.opacity(0.32), radius: 7, y: 3)
  }
}

struct SyncPill: View {
  @EnvironmentObject private var model: WatchAppModel

  var body: some View {
    Button {
      model.openSyncStatus()
    } label: {
      HStack(spacing: 4) {
        Circle()
          .fill(dotColor)
          .frame(width: 6, height: 6)
        Text(model.syncLabel)
          .font(.caption2.weight(.semibold))
          .lineLimit(1)
      }
      .foregroundStyle(WatchTheme.muted)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(WatchTheme.surface, in: Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier("watch.sync.status")
  }

  private var dotColor: Color {
    if model.state.syncIssue != nil { return WatchTheme.warning }
    if model.pendingCommandCount > 0 { return WatchTheme.amber }
    if model.isPhoneReachable { return WatchTheme.success }
    return WatchTheme.muted
  }
}

struct EmptyStateCard: View {
  let icon: String
  let title: String
  let message: String
  var actionTitle: String?
  var action: (() -> Void)?

  var body: some View {
    VStack(spacing: 8) {
      Image(systemName: icon)
        .font(.title2)
        .foregroundStyle(WatchTheme.amber)
      Text(title)
        .font(.headline)
        .multilineTextAlignment(.center)
      Text(message)
        .font(.caption)
        .foregroundStyle(WatchTheme.muted)
        .multilineTextAlignment(.center)
      if let actionTitle, let action {
        Button(actionTitle, action: action)
          .buttonStyle(.borderedProminent)
          .tint(WatchTheme.amber)
          .foregroundStyle(WatchTheme.background)
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 12)
  }
}
