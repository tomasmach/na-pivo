import { readFileSync } from "node:fs";
import path from "node:path";

const read = (...parts: string[]): string =>
  readFileSync(path.join(process.cwd(), ...parts), "utf8").replace(/\s+/g, " ");

describe("Apple alcohol competition safety (source-level)", () => {
  it("FriendsScreen has no streak competition UI or copy", () => {
    const source = read("src", "friends", "FriendsScreen.tsx");

    expect(source).not.toContain("streakAtRisk");
    expect(source).not.toContain("d?.streak.currentWeeks");
    expect(source).not.toContain("cs.friends.streakWeeks");
    expect(source).not.toContain("cs.friends.noStreak");
    expect(source).not.toContain("cs.friends.streakRiskFact");

    expect(source).toMatch(/factStrong=\{null\}/);
    expect(source).toMatch(/factMuted=\{null\}/);
  });

  it("Party detail screen has no streak/shared-pub competition stats", () => {
    const source = read("app", "parta", "[id].tsx");

    expect(source).not.toContain("sharedPubCount");
    expect(source).not.toContain("statSharedBeers");
    expect(source).not.toContain("streakWeeks");
    expect(source).not.toContain("statStreakTogether");
    expect(source).not.toContain("FlameIcon");

    expect(source).toContain("nightsTogether");
    expect(source).toContain("rituals.length");
    expect(source).toContain("statNightsTogether");
    expect(source).toContain("statRitualsTogether");
  });

  it("keeps the account preview on pub mapping rather than beer competition", () => {
    const source = read("src", "onboarding", "OnboardingPreview.tsx");
    expect(source).not.toContain('unit="piv"');
    // The board copy moved into i18n; the preview must still pull the mapper
    // board, and the strings behind those keys are checked below.
    expect(source).toContain("t.onboarding.previewBoardTitle");
    expect(source).toContain("t.onboarding.previewBoardUnit");

    const strings = read("src", "i18n", "cs.ts");
    const onboarding = strings.slice(
      strings.indexOf("onboarding: {"),
      strings.indexOf("celebration: {"),
    );
    expect(onboarding).toContain("Mapéři tenhle měsíc");
    expect(onboarding).toMatch(/previewBoardUnit:\s*["']hospod["']/);
  });

  it("onboarding copy avoids alcohol competition stats and keeps pub mapping framing", () => {
    const source = read("src", "i18n", "cs.ts");
    const onboarding = source.slice(
      source.indexOf("onboarding: {"),
      source.indexOf("celebration: {"),
    );

    expect(onboarding).not.toContain("Statistiky a rekordy naskakují samy");
    expect(onboarding).not.toContain("Odznaky, série a žebříčky");

    expect(onboarding).toContain("Soukromý přehled večerů naskakuje sám");
    expect(onboarding).toContain("Odznaky a mapérské žebříčky");
  });
});
