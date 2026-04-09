import { describe, expect, test } from "bun:test";
import { matchFiles, normalizeToNfc, removeExtension } from "../src/lib/matcher";

describe("removeExtension", () => {
  test("removes single extension", () => expect(removeExtension("photo.jpg")).toBe("photo"));
  test("handles no extension", () => expect(removeExtension("photo")).toBe("photo"));
  test("handles multiple dots", () =>
    expect(removeExtension("my.photo.final.jpg")).toBe("my.photo.final"));
});

describe("normalizeToNfc", () => {
  test("normalizes decomposed unicode to composed NFC", () => {
    const decomposed = "cafe\u0301";
    const composed = normalizeToNfc(decomposed);
    expect(composed).toBe("café");
  });
});

describe("matchFiles", () => {
  const files = [
    {
      id: "1",
      name: "sunset_beach.jpg",
      mimeType: "image/jpeg",
      path: "vacation/",
      size: "0",
      md5Hash: null,
    },
    {
      id: "2",
      name: "sunset_beach.png",
      mimeType: "image/png",
      path: "vacation/",
      size: "0",
      md5Hash: null,
    },
    {
      id: "3",
      name: "Photo_001.JPG",
      mimeType: "image/jpeg",
      path: "photos/",
      size: "0",
      md5Hash: null,
    },
    {
      id: "4",
      name: "avatar.psd",
      mimeType: "image/vnd.adobe.photoshop",
      path: "design/",
      size: "0",
      md5Hash: null,
    },
  ];

  test("matches case-insensitive without extension", () => {
    const result = matchFiles(files, ["photo_001"], {});
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].name).toBe("Photo_001.JPG");
  });

  test("returns all extensions for same base name", () => {
    const result = matchFiles(files, ["sunset_beach"], {});
    expect(result.matched).toHaveLength(2);
  });

  test("reports unmatched names", () => {
    const result = matchFiles(files, ["nonexistent"], {});
    expect(result.unmatched).toEqual(["nonexistent"]);
  });

  test("matchFiles itself does not deduplicate — dedup happens at CLI layer", () => {
    const result = matchFiles(files, ["avatar", "avatar", "AVATAR"], {});
    expect(result.matched).toHaveLength(3);
  });

  test("includes path in matched items", () => {
    const result = matchFiles(files, ["sunset_beach"], {});
    expect(result.matched[0].path).toBe("vacation/");
    expect(result.matched[1].path).toBe("vacation/");
  });

  test("fuzzy matching returns candidates within distance 3", () => {
    const result = matchFiles(files, ["phoot_001"], { fuzzy: true });
    expect(result.unmatched).toContain("phoot_001");
    const fuzzyMatch = result.fuzzyMatches.find((f) => f.name === "phoot_001");
    expect(fuzzyMatch?.candidates.length ?? 0).toBeGreaterThan(0);
    expect(fuzzyMatch?.candidates[0].distance).toBeLessThanOrEqual(3);
  });

  test("NFC normalization matches decomposed input to NFC-stored file", () => {
    const nfcFile = {
      id: "5",
      name: "café_document.pdf",
      mimeType: "application/pdf",
      path: "docs/",
      size: "0",
      md5Hash: null,
    };
    const result = matchFiles([nfcFile], ["cafe\u0301_document"], {});
    expect(result.matched).toHaveLength(1);
  });
});
