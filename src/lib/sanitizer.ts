export function sanitizePathSegment(segment: string): string {
  return segment
    .replace(/^[.-]+/, "")
    .replace(/[*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeOutputPath(relativePath: string): string {
  if (!relativePath) return "";
  const segments = relativePath.split(/[/\\]/).filter((s) => s.length > 0 && s !== ".");
  const result: string[] = [];
  for (const seg of segments) {
    if (seg === "..") {
      result.pop();
    } else {
      result.push(sanitizePathSegment(seg));
    }
  }
  return result.join("/");
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
