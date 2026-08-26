import { readFileSync } from "node:fs";
import { join } from "node:path";

const sourcePath = join(__dirname, "..", "account.tsx");
const raw = readFileSync(sourcePath, "utf8");

/** Collapse all whitespace so regexes are formatting-tolerant. */
const src = raw.replace(/\s+/g, " ");

/**
 * Returns the balanced-brace snippet starting at the first occurrence of
 * `marker` (whitespace-normalized source), including the enclosing braces.
 */
function blockFrom(marker: string, from = 0): string {
  const idx = src.indexOf(marker, from);
  if (idx === -1) return "";
  const open = src.indexOf("{", idx);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(idx, i + 1);
    }
  }
  return src.slice(idx);
}

describe("app/account.tsx source contract", () => {
  test("declares isClaimed from providers.length > 0", () => {
    expect(src).toMatch(/const\s+isClaimed\s*=\s*providers\.length\s*>\s*0/);
  });

  test("export MoreRow exists with Share2Icon and cs.account.exportData", () => {
    const exportIdx = src.search(/key\s*:\s*["']export["']/);
    expect(exportIdx).toBeGreaterThanOrEqual(0);
    const row = src.slice(Math.max(0, exportIdx - 600), exportIdx + 900);
    expect(row).toMatch(/Share2Icon/);
    expect(row).toMatch(/cs\.account\.exportData/);
  });

  test("delete MoreRow exists with cs.account.deleteAccount", () => {
    const deleteIdx = src.search(/key\s*:\s*["']delete["']/);
    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    const row = src.slice(Math.max(0, deleteIdx - 600), deleteIdx + 900);
    expect(row).toMatch(/cs\.account\.deleteAccount/);
  });

  test("logout QuietPill block is wrapped by isClaimed", () => {
    expect(src).toMatch(
      /\{\s*isClaimed\s*\?\s*\([\s\S]{0,500}<QuietPill[\s\S]{0,500}cs\.account\.logout/,
    );
  });

  test("anonymous card uses cs.account.anonymousName and cs.account.anonymousDataNote", () => {
    const cardIdx = src.indexOf("anonymousName");
    expect(cardIdx).toBeGreaterThanOrEqual(0);
    const card = src.slice(cardIdx, cardIdx + 1200);
    expect(card).toMatch(/cs\.account\.anonymousName/);
    expect(src).toMatch(/cs\.account\.anonymousDataNote/);
  });

  test("handleExportData: busy export, await exportAccountData, failure detail, finally reset", () => {
    const fn = blockFrom("const handleExportData");
    expect(fn).not.toBe("");

    // atomically claims the export operation before the async boundary
    expect(fn).toMatch(/startBusy\(\s*["']export["']\s*\)/);

    // awaits the data client call
    expect(fn).toMatch(/await\s+(?:\(\s*await\s+)?exportAccountData/);

    // failure path surfaces a result detail
    expect(fn).toMatch(
      /result\.ok[\s\S]{0,300}cs\.account\.exportDataToast[\s\S]{0,300}result\.detail/,
    );

    // busy state always resets
    expect(fn).toMatch(/finally\s*\{[\s\S]*finishBusy\(\s*["']export["']\s*\)/);
  });
});
