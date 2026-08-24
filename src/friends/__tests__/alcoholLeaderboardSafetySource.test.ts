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

    const metricsMatch = squashed.match(/const\s+METRICS[^=]*=\s*\[[\s\S]*?\]\s*(?:as\s+const)?;?/);
    expect(metricsMatch).toBeTruthy();
    const metrics = metricsMatch![0];
    expect(metrics).toContain("Hospody");
    expect(metrics).toContain("Mapér XP");
    expect(metrics).not.toContain("Piva");
    expect(metrics).not.toContain("beers");

    expect(squashed).toMatch(/useState<Metric>\(\s*["']Hospody["']/);

    expect(squashed).toMatch(/\bHospody\s*:\s*["']pubs["']/);
    expect(squashed).toMatch(/["']Mapér XP["']\s*:\s*["']mapper["']/);
  });
});
