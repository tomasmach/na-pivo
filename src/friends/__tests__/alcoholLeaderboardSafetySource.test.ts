import fs from "node:fs";
import path from "node:path";

const read = (...segments: string[]): string =>
  fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");

describe("alcohol leaderboard safety", () => {
  const friendsSource = read("src", "friends", "FriendsScreen.tsx");
  const forbidden = ["fetchLeaderboard", "weeklyBoard", "rankLine", "teaserTitleRank"];

  it("FriendsScreen has no alcohol leaderboard remnants", () => {
    for (const token of forbidden) {
      expect(friendsSource).not.toContain(token);
    }
    expect(
      /fetchLeaderboard\s*\(\s*[\s\S]*?beers[\s\S]*?week/.test(friendsSource),
    ).toBe(false);
    expect(friendsSource).toContain("/leaderboards");
    expect(friendsSource).toContain("fetchPhotoContestTeaser");
    expect(friendsSource).toContain("PartyCard");
  });

  it("CommunityMockScreen metrics exclude beers", () => {
    const communitySource = read(
      "src",
      "community",
      "CommunityMockScreen.tsx",
    );
    const squashed = communitySource.replace(/\s+/g, " ");

    // The metric is a stable key now, and its label comes from i18n, so the
    // guarantee to check is that no beer-volume board can be selected at all.
    const metricsMatch = squashed.match(/const\s+METRICS[^=]*=\s*\[[\s\S]*?\]\s*(?:as\s+const)?;?/);
    expect(metricsMatch).toBeTruthy();
    const metrics = metricsMatch![0];
    expect(metrics).toContain("'pubs'");
    expect(metrics).toContain("'mapper'");
    expect(metrics).not.toContain("beers");

    expect(squashed).toMatch(/useState<Metric>\(\s*["']pubs["']/);

    // Labels stay on pubs and Mapér XP, never on litres drunk.
    expect(squashed).toMatch(/pubs\s*:\s*t\.community\.metricPubs/);
    expect(squashed).toMatch(/mapper\s*:\s*t\.community\.metricMapper/);

    const categoryMatch = squashed.match(/const\s+CATEGORY[^=]*=\s*\{[\s\S]*?\};/);
    expect(categoryMatch).toBeTruthy();
    expect(categoryMatch![0]).not.toContain("beers");
  });
});
