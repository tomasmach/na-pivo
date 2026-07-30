import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("BeerEveningLiveActivity watchOS Smart Stack layout", () => {
  const source = readFileSync(
    resolve(__dirname, "..", "BeerEveningLiveActivity.tsx"),
    "utf8",
  );
  const bannerSmall = source.slice(
    source.indexOf("bannerSmall:"),
    source.indexOf("compactLeading:"),
  );

  it("keeps pub, count and one durable concrete repeat action in the small family", () => {
    expect(bannerSmall).toContain("{props.pubName}");
    expect(bannerSmall).toContain("{`${props.beerCount} ${beerWord}`}");
    expect(bannerSmall).toContain("label={repeatActionLabel}");
    expect(bannerSmall.match(/target="add-beer"/g)).toHaveLength(1);
    expect(bannerSmall).toMatch(
      /accessibilityLabel\(\s*`Zopakovat \$\{props\.repeatBeerName\}, \$\{repeatMetadata\}`/,
    );
  });
});
