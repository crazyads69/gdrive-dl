import { describe, expect, test } from "bun:test";
import { extractFolderId } from "../src/lib/drive";

describe("extractFolderId", () => {
  test("extracts from full URL", () => {
    expect(extractFolderId("https://drive.google.com/drive/folders/1abc123def?usp=sharing")).toBe(
      "1abc123def"
    );
  });

  test("extracts from /u/0/ URL", () => {
    expect(extractFolderId("https://drive.google.com/drive/u/0/folders/1abc123def")).toBe(
      "1abc123def"
    );
  });

  test("extracts from URL with id parameter", () => {
    expect(extractFolderId("https://drive.google.com/drive/folders/1abc123def?id=OTHER")).toBe(
      "1abc123def"
    );
  });

  test("returns raw ID as-is", () => {
    expect(extractFolderId("1abc123def")).toBe("1abc123def");
    expect(extractFolderId("ABCabc123_456-789")).toBe("ABCabc123_456-789");
  });

  test("throws on invalid input", () => {
    expect(() => extractFolderId("not a url or id!")).toThrow();
    expect(() => extractFolderId("")).toThrow();
    expect(() => extractFolderId("short")).toThrow();
  });
});
