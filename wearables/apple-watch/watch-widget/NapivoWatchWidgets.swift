import SwiftUI
import WidgetKit

@main
struct NapivoWatchWidgets: WidgetBundle {
  var body: some Widget {
    NapivoWatchWidget()
  }
}

struct NapivoWatchWidget: Widget {
  static let kind = "NapivoEveningWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Self.kind, provider: NapivoTimelineProvider()) { entry in
      NapivoWatchWidgetView(entry: entry)
        .containerBackground(
          Color(red: 31 / 255, green: 19 / 255, blue: 8 / 255),
          for: .widget
        )
    }
    .configurationDisplayName("Na pivo")
    .description("Hospoda, počet a rychlé zopakování posledního drinku.")
    .supportedFamilies([
      .accessoryRectangular,
      .accessoryCircular,
      .accessoryInline,
    ])
  }
}

struct NapivoTimelineEntry: TimelineEntry {
  let date: Date
  let snapshot: WatchWidgetSnapshot
}

struct NapivoTimelineProvider: TimelineProvider {
  func placeholder(in context: Context) -> NapivoTimelineEntry {
    NapivoTimelineEntry(
      date: Date(),
      snapshot: WatchWidgetSnapshot(
        pubName: "U Zlatého tygra",
        beerCount: 3,
        otherCount: 1,
        totalCzk: 253,
        repeatDrinkName: "Pilsner Urquell 12°",
        repeatDrinkSummary: "pivo · 0,5 l · 68 Kč",
        hasActiveEvening: true,
        pendingCommandCount: 0,
        updatedAt: Date()
      )
    )
  }

  func getSnapshot(
    in context: Context,
    completion: @escaping (NapivoTimelineEntry) -> Void
  ) {
    completion(NapivoTimelineEntry(date: Date(), snapshot: WatchDataStore.loadWidgetSnapshot()))
  }

  func getTimeline(
    in context: Context,
    completion: @escaping (Timeline<NapivoTimelineEntry>) -> Void
  ) {
    let entry = NapivoTimelineEntry(date: Date(), snapshot: WatchDataStore.loadWidgetSnapshot())
    completion(Timeline(entries: [entry], policy: .never))
  }
}

struct NapivoWatchWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: NapivoTimelineEntry

  var body: some View {
    switch family {
    case .accessoryRectangular:
      rectangular
    case .accessoryCircular:
      circular
    case .accessoryInline:
      inline
    default:
      rectangular
    }
  }

  private var rectangular: some View {
    Group {
      if entry.snapshot.hasActiveEvening {
        Button(intent: RepeatLastDrinkIntent()) {
          VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
              Text(entry.snapshot.pubName ?? "Na pivo")
                .font(.caption.weight(.bold))
                .foregroundStyle(foam)
                .lineLimit(1)
                .privacySensitive()
              Spacer(minLength: 2)
              Text("\(entry.snapshot.beerCount)")
                .font(.title3.monospacedDigit().weight(.black))
                .foregroundStyle(amber)
            }
            HStack(alignment: .center, spacing: 4) {
              Image(systemName: "plus.circle.fill")
                .foregroundStyle(amber)
              VStack(alignment: .leading, spacing: 0) {
                Text("Znovu \(entry.snapshot.repeatDrinkName ?? "poslední drink")")
                  .fontWeight(.bold)
                  .lineLimit(1)
                  .privacySensitive()
                if let summary = entry.snapshot.repeatDrinkSummary {
                  Text(summary)
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(muted)
                    .lineLimit(1)
                    .privacySensitive()
                }
              }
            }
            .font(.caption2)
            if entry.snapshot.pendingCommandCount > 0 {
              Text("Čeká \(entry.snapshot.pendingCommandCount)")
                .font(.system(size: 8, weight: .semibold))
                .foregroundStyle(muted)
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(repeatAccessibilityLabel)
        .privacySensitive()
      } else {
        VStack(alignment: .leading, spacing: 3) {
          Label("Na pivo", systemImage: "location.north.fill")
            .font(.caption.weight(.bold))
            .foregroundStyle(amber)
          Text(entry.snapshot.pubName ?? "Najdi nejbližší hospodu")
            .font(.caption2)
            .foregroundStyle(foam)
            .lineLimit(2)
            .privacySensitive()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      }
    }
  }

  private var circular: some View {
    Group {
      if entry.snapshot.hasActiveEvening {
        Button(intent: RepeatLastDrinkIntent()) {
          circularContent
        }
        .buttonStyle(.plain)
        .privacySensitive()
      } else {
        circularContent
      }
    }
    .accessibilityLabel("\(entry.snapshot.beerCount) piv")
  }

  private var inline: some View {
    Group {
      if entry.snapshot.hasActiveEvening {
        Button(intent: RepeatLastDrinkIntent()) {
          Label(
            "Znovu \(entry.snapshot.repeatDrinkName ?? "drink") · \(entry.snapshot.beerCount) piv",
            systemImage: "plus.circle.fill"
          )
        }
        .buttonStyle(.plain)
      } else {
        Label(
          "\(entry.snapshot.pubName ?? "Na pivo") · \(entry.snapshot.beerCount) piv",
          systemImage: "mug.fill"
        )
      }
    }
    .privacySensitive()
  }

  private var repeatAccessibilityLabel: String {
    let name = entry.snapshot.repeatDrinkName ?? "poslední drink"
    let summary = entry.snapshot.repeatDrinkSummary ?? ""
    return "Zopakovat \(name), \(summary)"
  }

  private var circularContent: some View {
    ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: -2) {
        Image(systemName: entry.snapshot.hasActiveEvening ? "plus.circle.fill" : "mug.fill")
          .font(.caption)
          .foregroundStyle(amber)
        Text("\(entry.snapshot.beerCount)")
          .font(.title2.monospacedDigit().weight(.black))
          .foregroundStyle(foam)
      }
    }
  }

  private var amber: Color {
    Color(red: 232 / 255, green: 163 / 255, blue: 23 / 255)
  }

  private var foam: Color {
    Color(red: 251 / 255, green: 243 / 255, blue: 224 / 255)
  }

  private var muted: Color {
    Color(red: 168 / 255, green: 137 / 255, blue: 106 / 255)
  }
}
