import SwiftUI
import WatchKit

struct CompassView: View {
  @EnvironmentObject private var model: WatchAppModel

  var body: some View {
    content
      .background(WatchTheme.background.ignoresSafeArea())
      .toolbar(.hidden, for: .navigationBar)
  }

  @ViewBuilder
  private var content: some View {
    switch model.locationState {
    case .idle, .requestingPermission, .locating:
      if model.selectedTarget != nil {
        targetPager(
          locationMessage: model.locationState == .locating
            ? "Polohu ještě ladím." : "Čekám na povolení polohy."
        )
      } else {
        stateScroll {
          ProgressView()
            .tint(WatchTheme.amber)
          Text(model.locationState == .locating ? "Hledám hospodu…" : "Chystám kompas…")
            .font(.caption)
            .foregroundStyle(WatchTheme.muted)
        }
      }
    case .denied:
      if model.selectedTarget != nil {
        targetPager(
          locationMessage: "Cíl mám. Bez polohy neukážu směr.",
          retryLocation: true
        )
      } else {
        stateScroll {
          EmptyStateCard(
            icon: "location.slash.fill",
            title: "Bez polohy netrefím",
            message: "Povol polohu pro Na pivo v Nastavení hodinek.",
            actionTitle: "Zkusit znovu",
            action: model.retryLocation
          )
        }
      }
    case .restricted:
      if model.selectedTarget != nil {
        targetPager(
          locationMessage: "Cíl mám. Poloha je ale zamčená.",
          retryLocation: true
        )
      } else {
        stateScroll {
          EmptyStateCard(
            icon: "hand.raised.fill",
            title: "Poloha je zamčená",
            message: "Omezení polohy musíš změnit v Nastavení."
          )
        }
      }
    case .unavailable, .failed:
      if model.selectedTarget != nil {
        targetPager(
          locationMessage: "Polohu teď nemám. Uložený cíl držím.",
          retryLocation: true
        )
      } else {
        stateScroll {
          EmptyStateCard(
            icon: "location.magnifyingglass",
            title: "Kompas si dává pauzu",
            message: "Zkus polohu znovu. Uložený večer zůstává v bezpečí.",
            actionTitle: "Zkusit znovu",
            action: model.retryLocation
          )
        }
      }
    case .ready:
      if model.selectedTarget != nil {
        targetPager()
      } else if model.isLoadingNearby {
        stateScroll {
          ProgressView()
            .tint(WatchTheme.amber)
          Text("Rozhlížím se po výčepech…")
            .font(.caption)
            .foregroundStyle(WatchTheme.muted)
        }
      } else {
        stateScroll {
          EmptyStateCard(
            icon: "mug",
            title: "Kde nic, tu nic",
            message: "V dosahu nemám vhodnou hospodu. Můžeš to zkusit znovu.",
            actionTitle: "Obnovit",
            action: model.retryLocation
          )
        }
      }
    }
  }

  private func stateScroll<Content: View>(
    @ViewBuilder content: () -> Content
  ) -> some View {
    ScrollView {
      VStack(spacing: 12) {
        statusRow
        content()
      }
      .frame(maxWidth: .infinity)
      .padding(.horizontal, 8)
      .padding(.top, 8)
    }
  }

  private func targetPager(
    locationMessage: String? = nil,
    retryLocation: Bool = false
  ) -> some View {
    TabView {
      compassHero
        .accessibilityIdentifier("watch.compass.heroPage")

      compassActions(
        locationMessage: locationMessage,
        retryLocation: retryLocation
      )
      .accessibilityIdentifier("watch.compass.actionPage")
    }
    .tabViewStyle(.verticalPage)
    .accessibilityIdentifier("watch.compass.pages")
  }

  private var compassHero: some View {
    GeometryReader { _ in
      // TabView reports only the rounded safe rectangle. The mobile compass is
      // circular and can safely reclaim those corner insets, so size it from
      // the physical watch display instead of shrinking it to the safe width.
      let dialSize = WKInterfaceDevice.current().screenBounds.width * 0.78

      VStack(spacing: 1) {
        MobileParityCompass(
          bearing: model.relativeBearing,
          size: max(120, dialSize)
        )
        .accessibilityLabel(
          model.relativeBearing == nil
            ? "Směr teď nejde" : "Směr k hospodě"
        )

        if let target = model.selectedTarget {
          Text(target.name)
            .font(.custom("Baloo2-ExtraBold", fixedSize: 16))
            .foregroundStyle(WatchTheme.cream)
            .lineLimit(1)
            .minimumScaleFactor(0.68)
            .privacySensitive()

          Text(
            model.relativeBearing == nil
              ? "\(distanceText) · bez směru" : distanceText
          )
          .font(.custom("Baloo2-ExtraBold", fixedSize: 17))
          .monospacedDigit()
          .foregroundStyle(WatchTheme.amberSoft)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
          .padding(.horizontal, 18)
        }
      }
      .multilineTextAlignment(.center)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
      .offset(y: -12)
      .accessibilityElement(children: .combine)
      .accessibilityIdentifier("watch.compass.target")
    }
  }

  private func compassActions(
    locationMessage: String?,
    retryLocation: Bool
  ) -> some View {
    VStack(spacing: 6) {
      if model.networkUnavailable {
        Label("Offline", systemImage: "wifi.slash")
          .font(.caption2.weight(.semibold))
          .foregroundStyle(WatchTheme.warning)
      } else if model.state.isStale {
        Label("Starší data", systemImage: "clock.arrow.circlepath")
          .font(.caption2.weight(.semibold))
          .foregroundStyle(WatchTheme.amber)
      }

      if let target = model.selectedTarget {
        Text(target.name)
          .font(.custom("Baloo2-ExtraBold", fixedSize: 17))
          .foregroundStyle(WatchTheme.cream)
          .lineLimit(2)
          .minimumScaleFactor(0.72)
          .multilineTextAlignment(.center)
          .privacySensitive()
      }

      if let locationMessage {
        HStack(spacing: 5) {
          Image(systemName: retryLocation ? "location.slash.fill" : "location.circle")
          Text(locationMessage)
            .lineLimit(2)
          if retryLocation {
            Button("Zkusit") {
              model.retryLocation()
            }
            .buttonStyle(.plain)
            .foregroundStyle(WatchTheme.amber)
          }
        }
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(WatchTheme.muted)
      }

      Button {
        model.askToLogAtTarget()
      } label: {
        Label(
          model.hasActiveEvening ? "Zapsat tady" : "Jsem tady",
          systemImage: "checkmark.circle.fill"
        )
        .frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .controlSize(.small)
      .tint(WatchTheme.amber)
      .foregroundStyle(WatchTheme.background)
      .accessibilityIdentifier("watch.compass.confirmPub")

      Button {
        model.openTargetPicker()
      } label: {
        Label("Jiná hospoda", systemImage: "list.bullet")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.bordered)
      .controlSize(.small)
      .tint(WatchTheme.amber)
      .accessibilityIdentifier("watch.compass.changeTarget")

      Text("Návštěvu potvrdíš ty, ne GPS.")
        .font(.system(size: 9))
        .foregroundStyle(WatchTheme.muted)
        .multilineTextAlignment(.center)
        .lineLimit(2)
    }
    .padding(.horizontal, 9)
    .padding(.vertical, 2)
  }

  private var statusRow: some View {
    HStack(spacing: 5) {
      if model.networkUnavailable {
        Label("Offline", systemImage: "wifi.slash")
          .foregroundStyle(WatchTheme.warning)
      } else if model.state.isStale {
        Label("Starší data", systemImage: "clock.arrow.circlepath")
          .foregroundStyle(WatchTheme.amber)
      }
      Spacer(minLength: 2)
      SyncPill()
    }
    .font(.caption2.weight(.semibold))
  }

  private var distanceText: String {
    guard let distance = model.targetDistance else { return "—" }
    if distance < 1_000 {
      return "\(Int(distance.rounded())) m"
    }
    return String(format: "%.1f km", distance / 1_000)
      .replacingOccurrences(of: ".", with: ",")
  }
}

/// A direct 320-point projection of the mobile CompassDial/CompassArrow geometry.
/// Only the rendered size changes; every radius, tick and path keeps mobile ratios.
private struct MobileParityCompass: View {
  let bearing: Double?
  let size: CGFloat

  var body: some View {
    ZStack {
      MobileParityCompassDial()

      if let bearing {
        MobileParityCompassNeedle()
          .rotationEffect(.degrees(bearing))
          .animation(.easeOut(duration: 0.18), value: bearing)
      }

      MobileParityCompassHub()

    }
    .frame(width: size, height: size)
  }
}

private struct MobileParityCompassDial: View {
  private let textureDots: [(CGFloat, CGFloat, CGFloat)] = [
    (135, 120, 3),
    (180, 100, 2),
    (200, 150, 2.5),
    (175, 200, 2),
    (130, 190, 3),
    (110, 155, 2),
  ]

  private let cardinals: [(String, Double)] = [
    ("S", 0),
    ("V", 90),
    ("J", 180),
    ("Z", 270),
  ]

  var body: some View {
    Canvas { context, size in
      let scale = min(size.width, size.height) / 320
      let center = CGPoint(x: size.width / 2, y: size.height / 2)

      drawCircle(
        context: &context,
        center: center,
        radius: 150 * scale,
        fill: WatchTheme.raised,
        stroke: WatchTheme.amber,
        lineWidth: 3 * scale
      )
      drawCircle(
        context: &context,
        center: center,
        radius: 132 * scale,
        stroke: WatchTheme.amber.opacity(0.45),
        lineWidth: 1 * scale
      )
      drawCircle(
        context: &context,
        center: center,
        radius: 120 * scale,
        fill: WatchTheme.cream,
        stroke: WatchTheme.amber,
        lineWidth: 1.5 * scale
      )
      drawCircle(
        context: &context,
        center: center,
        radius: 104 * scale,
        stroke: WatchTheme.amber.opacity(0.55),
        lineWidth: 1 * scale
      )

      for (x, y, radius) in textureDots {
        drawCircle(
          context: &context,
          center: point(x: x, y: y, scale: scale),
          radius: radius * scale,
          fill: Color.white.opacity(0.55)
        )
      }

      for index in 0..<24 {
        let radians = (Double(index) * 15 - 90) * .pi / 180
        let isCardinal = index % 6 == 0
        let tickCenter = CGPoint(
          x: center.x + 145 * scale * cos(radians),
          y: center.y + 145 * scale * sin(radians)
        )
        drawCircle(
          context: &context,
          center: tickCenter,
          radius: (isCardinal ? 4 : 1.8) * scale,
          fill: isCardinal
            ? WatchTheme.amber
            : WatchTheme.muted.opacity(0.7)
        )
      }

      for (label, degrees) in cardinals {
        let radians = (degrees - 90) * .pi / 180
        let labelPoint = CGPoint(
          x: center.x + 88 * scale * cos(radians),
          y: center.y + 88 * scale * sin(radians)
        )
        let text = Text(label)
          .font(.custom("Baloo2-ExtraBold", fixedSize: 20 * scale))
          .foregroundStyle(WatchTheme.background)
        context.draw(context.resolve(text), at: labelPoint, anchor: .center)
      }
    }
  }

  private func point(x: CGFloat, y: CGFloat, scale: CGFloat) -> CGPoint {
    CGPoint(x: x * scale, y: y * scale)
  }

  private func drawCircle(
    context: inout GraphicsContext,
    center: CGPoint,
    radius: CGFloat,
    fill: Color? = nil,
    stroke: Color? = nil,
    lineWidth: CGFloat = 0
  ) {
    let rect = CGRect(
      x: center.x - radius,
      y: center.y - radius,
      width: radius * 2,
      height: radius * 2
    )
    let path = Path(ellipseIn: rect)
    if let fill {
      context.fill(path, with: .color(fill))
    }
    if let stroke {
      context.stroke(path, with: .color(stroke), lineWidth: lineWidth)
    }
  }
}

private struct MobileParityCompassNeedle: View {
  var body: some View {
    Canvas { context, size in
      let scale = min(size.width, size.height) / 320
      let glow = path(
        [(160, 35), (174, 158), (160, 148), (146, 158)],
        scale: scale
      )
      let north = path(
        [(160, 42), (171, 155), (160, 147), (149, 155)],
        scale: scale
      )
      let south = path(
        [(160, 278), (149, 165), (160, 173), (171, 165)],
        scale: scale
      )

      context.fill(glow, with: .color(WatchTheme.glow.opacity(0.08)))
      context.stroke(
        glow,
        with: .color(WatchTheme.glow.opacity(0.08)),
        style: StrokeStyle(lineWidth: 14 * scale, lineJoin: .round)
      )
      context.fill(glow, with: .color(WatchTheme.glow.opacity(0.14)))
      context.stroke(
        glow,
        with: .color(WatchTheme.glow.opacity(0.14)),
        style: StrokeStyle(lineWidth: 7 * scale, lineJoin: .round)
      )
      context.fill(glow, with: .color(WatchTheme.glow.opacity(0.24)))

      context.fill(south, with: .color(WatchTheme.creamMuted))
      context.stroke(
        south,
        with: .color(WatchTheme.background),
        style: StrokeStyle(lineWidth: 1.5 * scale, lineJoin: .round)
      )

      context.fill(north, with: .color(WatchTheme.amberSoft))
      context.stroke(
        north,
        with: .color(WatchTheme.background),
        style: StrokeStyle(lineWidth: 2 * scale, lineJoin: .round)
      )
    }
  }

  private func path(
    _ points: [(CGFloat, CGFloat)],
    scale: CGFloat
  ) -> Path {
    var path = Path()
    guard let first = points.first else { return path }
    path.move(to: CGPoint(x: first.0 * scale, y: first.1 * scale))
    for point in points.dropFirst() {
      path.addLine(to: CGPoint(x: point.0 * scale, y: point.1 * scale))
    }
    path.closeSubpath()
    return path
  }
}

private struct MobileParityCompassHub: View {
  var body: some View {
    Canvas { context, size in
      let scale = min(size.width, size.height) / 320
      let center = CGPoint(x: size.width / 2, y: size.height / 2)
      let outer = Path(
        ellipseIn: CGRect(
          x: center.x - 15 * scale,
          y: center.y - 15 * scale,
          width: 30 * scale,
          height: 30 * scale
        )
      )
      let inner = Path(
        ellipseIn: CGRect(
          x: center.x - 7 * scale,
          y: center.y - 7 * scale,
          width: 14 * scale,
          height: 14 * scale
        )
      )
      context.fill(outer, with: .color(WatchTheme.background))
      context.stroke(outer, with: .color(WatchTheme.amber), lineWidth: 2 * scale)
      context.fill(inner, with: .color(WatchTheme.amber))
    }
  }
}
