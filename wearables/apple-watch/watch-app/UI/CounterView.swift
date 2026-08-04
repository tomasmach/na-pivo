import SwiftUI

struct CounterView: View {
  @EnvironmentObject private var model: WatchAppModel
  @State private var showFinishConfirmation = false

  var body: some View {
    TabView {
      counterPage
        .accessibilityIdentifier("watch.counter.mainPage")

      actionsPage
        .accessibilityIdentifier("watch.counter.actionsPage")
    }
    .tabViewStyle(.verticalPage)
    .toolbar(.hidden, for: .navigationBar)
    .alert("Dopito?", isPresented: $showFinishConfirmation) {
      Button("Jo, zavřít večer") {
        model.finishEvening()
      }
      Button("Ještě jedno", role: .cancel) {}
    } message: {
      Text("Večer uzavřu. Další drink začne nový.")
    }
  }

  private var counterPage: some View {
    VStack(spacing: 6) {
      header

      HStack(alignment: .center, spacing: 10) {
        VStack(spacing: -6) {
          Text("\(model.currentEvening?.beerCount ?? 0)")
            .font(.system(size: 62, weight: .black, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(
              LinearGradient(
                colors: [WatchTheme.amberSoft, WatchTheme.amber],
                startPoint: .top,
                endPoint: .bottom
              )
            )
            .contentTransition(.numericText())
          Text(beerWord)
            .font(.system(size: 10, weight: .black))
            .textCase(.uppercase)
            .tracking(1.6)
            .foregroundStyle(WatchTheme.muted)
        }

        VStack(alignment: .leading, spacing: 4) {
          Text(otherSummary)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(WatchTheme.muted)
            .lineLimit(2)
            .minimumScaleFactor(0.75)
          Text("\(model.currentEvening?.totalCzk ?? 0) Kč")
            .font(.title3.monospacedDigit().weight(.bold))
            .foregroundStyle(WatchTheme.cream)
            .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .frame(maxWidth: .infinity)
      .accessibilityElement(children: .combine)
      .accessibilityIdentifier("watch.counter.summary")

      if let undo = model.undoOffer {
        undoStrip(undo)
      }

      repeatButton
    }
    .padding(.horizontal, 9)
    .padding(.vertical, 4)
  }

  private var actionsPage: some View {
    VStack(spacing: 7) {
      Button {
        model.openSyncStatus()
      } label: {
        VStack(alignment: .leading, spacing: 0) {
          Text("Další tah")
            .font(.headline)
            .foregroundStyle(WatchTheme.cream)
          Text(connectionLabel)
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(model.pendingCommandCount > 0 ? WatchTheme.amber : WatchTheme.muted)
            .lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Synchronizace: \(connectionLabel)")
      .accessibilityIdentifier("watch.counter.sync")

      lastDrinkCard

      Button {
        model.openDrinkPicker()
      } label: {
        Label("Jiný drink", systemImage: "ellipsis.circle")
          .frame(maxWidth: .infinity, minHeight: 36)
      }
      .buttonStyle(.borderedProminent)
      .tint(WatchTheme.raised)
      .foregroundStyle(WatchTheme.amberSoft)
      .accessibilityIdentifier("watch.counter.otherDrink")

      HStack(spacing: 7) {
        Button {
          model.openReceipt()
        } label: {
          VStack(spacing: 2) {
            Image(systemName: "list.bullet.rectangle")
            Text("Účet")
              .font(.caption)
          }
          .frame(maxWidth: .infinity, minHeight: 38)
        }
        .buttonStyle(.bordered)
        .tint(WatchTheme.amber)
        .accessibilityIdentifier("watch.counter.receipt")

        Button {
          showFinishConfirmation = true
        } label: {
          VStack(spacing: 2) {
            Image(systemName: "checkered.flag")
            Text("Dopito")
              .font(.caption)
          }
          .frame(maxWidth: .infinity, minHeight: 38)
        }
        .buttonStyle(.bordered)
        .tint(WatchTheme.amber)
        .accessibilityIdentifier("watch.counter.finish")
      }
    }
    .padding(.horizontal, 9)
    .padding(.vertical, 4)
  }

  private var header: some View {
    HStack(spacing: 6) {
      Button {
        model.openSyncStatus()
      } label: {
        VStack(alignment: .leading, spacing: 1) {
          Text(model.currentEvening?.pub.name ?? "Večer")
            .font(.custom("Baloo2-ExtraBold", fixedSize: 13))
            .foregroundStyle(WatchTheme.cream)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .privacySensitive()
          Text(connectionLabel)
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(model.pendingCommandCount > 0 ? WatchTheme.amber : WatchTheme.muted)
            .lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Synchronizace: \(connectionLabel)")
      .accessibilityIdentifier("watch.counter.sync")

      Button {
        model.openCompass()
      } label: {
        Image(systemName: "location.north.circle.fill")
          .font(.title3)
          .frame(width: 36, height: 36)
      }
      .buttonStyle(.plain)
      .foregroundStyle(WatchTheme.amber)
      // Keep the icon visually compact while giving it the full watchOS
      // interaction target without making this already-tight page taller.
      .contentShape(.interaction, Rectangle().inset(by: -4))
      .accessibilityLabel("Kompas")
      .accessibilityIdentifier("watch.counter.compass")
    }
  }

  private var lastDrinkCard: some View {
    WatchCard {
      VStack(alignment: .leading, spacing: 2) {
        Text("POSLEDNÍ")
          .font(.system(size: 9, weight: .black))
          .tracking(1.3)
          .foregroundStyle(WatchTheme.muted)
        if let drink = model.lastDrink {
          Text(drink.name)
            .font(.system(size: 15, weight: .bold, design: .rounded))
            .lineLimit(1)
            .minimumScaleFactor(0.72)
            .privacySensitive()
          Text(drink.summary)
            .font(.caption2)
            .foregroundStyle(WatchTheme.amberSoft)
            .lineLimit(1)
        } else {
          Text("Zatím prázdný tácek")
            .font(.caption)
            .foregroundStyle(WatchTheme.muted)
        }
      }
    }
  }

  private var repeatButton: some View {
    Button {
      model.repeatLastDrink()
    } label: {
      VStack(spacing: 1) {
        Text("ZOPAKOVAT")
          .font(.system(size: 9, weight: .black, design: .rounded))
          .tracking(1.1)
        if let drink = model.lastDrink {
          Text(drink.name)
            .font(.system(size: 16, weight: .black, design: .rounded))
            .lineLimit(1)
            .minimumScaleFactor(0.62)
            .privacySensitive()
          Text(drink.summary)
            .font(.system(size: 10, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
      }
      .frame(maxWidth: .infinity, minHeight: 50)
    }
    .buttonStyle(.borderedProminent)
    .tint(WatchTheme.amber)
    .foregroundStyle(WatchTheme.background)
    .disabled(model.lastDrink == nil)
    .onLongPressGesture(minimumDuration: 0.55) {
      model.repeatButtonLongPressed()
    }
    .accessibilityLabel(
      model.lastDrink.map { "Zopakovat \($0.repeatLabel)" } ?? "Není co zopakovat"
    )
    .accessibilityHint("Podržením otevřeš další drinky")
    .accessibilityIdentifier("watch.counter.repeat")
  }

  private func undoStrip(_ offer: WatchAppModel.UndoOffer) -> some View {
    HStack(spacing: 6) {
      Image(systemName: "checkmark.circle.fill")
        .foregroundStyle(WatchTheme.success)
      Text("Zapsáno")
        .font(.caption2.weight(.semibold))
      Spacer(minLength: 2)
      Button("Vrátit") {
        model.undoLastDrink()
      }
      .font(.caption.weight(.bold))
      .buttonStyle(.plain)
      .foregroundStyle(WatchTheme.amber)
      .frame(minWidth: 44, minHeight: 30)
      .accessibilityIdentifier("watch.counter.undo")
    }
    .padding(.leading, 9)
    .padding(.trailing, 4)
    .background(WatchTheme.surface, in: Capsule())
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Zapsáno \(offer.title)")
  }

  private var beerWord: String {
    let count = model.currentEvening?.beerCount ?? 0
    if count == 1 { return "pivo" }
    if (2...4).contains(count) { return "piva" }
    return "piv"
  }

  private var connectionLabel: String {
    model.networkUnavailable ? "Offline · \(model.syncLabel)" : model.syncLabel
  }

  private var otherSummary: String {
    guard let evening = model.currentEvening else { return "Jen pivo" }
    let values = DrinkType.allCases.compactMap { type -> String? in
      guard type != .beer, let count = evening.otherCounts[type], count > 0 else { return nil }
      return "\(count) \(type.shortTitle)"
    }
    return values.isEmpty ? "Jen pivo" : values.joined(separator: " · ")
  }
}
