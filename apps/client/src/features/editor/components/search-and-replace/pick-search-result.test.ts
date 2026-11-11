import { describe, expect, it } from "vitest";
import { pickSearchResult } from "./pick-search-result";

const contexts = [
  { before: "Intro: the ", after: " is installed first." },
  { before: "Later we restart the ", after: " after config changes." },
  { before: "Finally the ", after: " runs in the background." },
];

describe("pickSearchResult", () => {
  it("picks the match whose surrounding text fits the clicked snippet", () => {
    expect(
      pickSearchResult("we restart the <b>server</b> after config", contexts),
    ).toBe(1);
  });

  it("ignores whitespace differences between index text and editor text", () => {
    expect(
      pickSearchResult("Finally  the\n<b>server</b> runs   in", contexts),
    ).toBe(2);
  });

  it("anchors on the first bold term when a snippet has several", () => {
    expect(
      pickSearchResult(
        "restart the <b>server</b> after <b>config</b> changes",
        contexts,
      ),
    ).toBe(1);
  });

  it("falls back to the first match when the snippet has no bold term", () => {
    expect(pickSearchResult("no highlight here", contexts)).toBe(0);
  });

  it("falls back to the first match when there are no matches", () => {
    expect(pickSearchResult("the <b>server</b> runs", [])).toBe(0);
  });
});
