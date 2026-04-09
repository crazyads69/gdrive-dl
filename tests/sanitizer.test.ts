import { describe, test, expect } from "bun:test";
import { sanitizePathSegment, sanitizeOutputPath } from "../src/lib/sanitizer";

describe("sanitizePathSegment", () => {
  test("strips parent-directory traversal", () => {
    expect(sanitizeOutputPath("../etc/passwd")).toBe("etc/passwd");
    expect(sanitizeOutputPath("foo/../bar")).toBe("bar");
    expect(sanitizeOutputPath("foo/bar/../baz")).toBe("foo/baz");
    expect(sanitizeOutputPath("../../../etc/passwd")).toBe("etc/passwd");
  });

  test("replaces illegal OS characters", () => {
    expect(sanitizePathSegment("file*name?.txt")).toBe("file_name_.txt");
    expect(sanitizePathSegment("path|with|pipes")).toBe("path_with_pipes");
    expect(sanitizePathSegment('quote"file"name')).toBe("quote_file_name");
  });

  test("strips leading dots", () => {
    expect(sanitizePathSegment("...hidden")).toBe("hidden");
    expect(sanitizePathSegment(".htaccess")).toBe("htaccess");
  });

  test("collapses whitespace", () => {
    expect(sanitizePathSegment("file   name")).toBe("file name");
  });

  test("trims whitespace", () => {
    expect(sanitizePathSegment("  filename  ")).toBe("filename");
  });
});

describe("sanitizeOutputPath", () => {
  test("normalizes mixed separators and sanitizes", () => {
    expect(sanitizeOutputPath("foo\\bar//baz/..qux")).toBe("foo/bar/baz/qux");
  });

  test("handles empty segments", () => {
    expect(sanitizeOutputPath("foo//bar")).toBe("foo/bar");
    expect(sanitizeOutputPath("foo/./bar")).toBe("foo/bar");
  });

  test("returns empty string for empty path", () => {
    expect(sanitizeOutputPath("")).toBe("");
    expect(sanitizeOutputPath("  ")).toBe("");
  });

  test("strips traversal attempts", () => {
    expect(sanitizeOutputPath("../../../etc/passwd")).toBe("etc/passwd");
  });
});
