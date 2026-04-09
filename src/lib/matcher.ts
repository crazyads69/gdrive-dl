import type { DriveFile } from "./drive.ts";

export interface MatchResult {
  matched: DriveFile[];
  unmatched: string[];
  fuzzyMatches: Array<{
    name: string;
    candidates: Array<{ name: string; path: string; distance: number }>;
  }>;
}

export interface MatchOptions {
  fuzzy?: boolean;
}

export function normalizeToNfc(str: string): string {
  return str.normalize("NFC");
}

export function removeExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === 0) return filename;
  return filename.slice(0, lastDot);
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
      }
    }
  }
  return matrix[b.length][a.length];
}

export function matchFiles(
  allFiles: DriveFile[],
  searchNames: string[],
  options: MatchOptions = {}
): MatchResult {
  const matched: DriveFile[] = [];
  const unmatched: string[] = [];
  const fuzzyMatches: MatchResult["fuzzyMatches"] = [];

  for (const name of searchNames) {
    const normalized = normalizeToNfc(name);

    const exact = allFiles.filter(
      (f) => normalizeToNfc(removeExtension(f.name)).toLowerCase() === normalized.toLowerCase()
    );

    if (exact.length > 0) {
      matched.push(...exact);
      continue;
    }

    if (options.fuzzy) {
      const candidates = allFiles
        .map((f) => ({
          file: f,
          distance: levenshtein(
            normalized.toLowerCase(),
            normalizeToNfc(removeExtension(f.name)).toLowerCase()
          ),
        }))
        .filter((s) => s.distance <= 3)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3)
        .map((s) => ({ name: s.file.name, path: s.file.path, distance: s.distance }));

      if (candidates.length > 0) {
        fuzzyMatches.push({ name, candidates });
      }
    }

    unmatched.push(name);
  }

  return { matched, unmatched, fuzzyMatches };
}
