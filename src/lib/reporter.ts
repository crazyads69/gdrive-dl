import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REPORTS_DIR } from "../constants.ts";
import { getConfigDir, getReportsDir } from "./config.ts";
import { logWarn } from "./logger.ts";

export interface DownloadReport {
  status: "success" | "partial" | "aborted";
  metadata: {
    tool: string;
    version: string;
    runtime: string;
    command: string;
    startTime: string;
    endTime: string;
    durationMs: number;
    userEmail: string | null;
    args: {
      url: string;
      outputDir: string;
      recursive: boolean;
      concurrency: number;
      retries: number;
      overwrite: boolean;
      resume: boolean;
      checksum: boolean;
      fuzzy: boolean;
      dryRun: boolean;
      fileSource?: string;
      namesCount?: number;
    };
  };
  summary: {
    matched: number;
    downloaded: number;
    verified: number;
    failed: number;
    skipped: number;
    notFound: number;
  };
  items: Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    outputPath: string;
    matchedBy: "exact" | "fuzzy";
    status: "success" | "failed" | "skipped";
    bytesTransferred: number;
    resumed: boolean;
    retryCount: number;
    checksum: {
      enabled: boolean;
      algorithm: "md5";
      verified: boolean;
      md5Remote?: string;
      md5Local?: string;
      reason?: string;
    };
    error?: { message: string; code?: string };
  }>;
  unmatched: string[];
  fuzzySuggestions?: Array<{
    name: string;
    candidates: Array<{ name: string; path: string; distance: number }>;
  }>;
}

export async function writeReport(report: DownloadReport, reportPath?: string): Promise<void> {
  const defaultDir = getReportsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const defaultPath = join(defaultDir, `${timestamp}.json`);

  const finalPath = reportPath ?? defaultPath;

  if (!reportPath && existsSync(finalPath)) {
    logWarn("Report file already exists. Use --overwrite to replace.");
    return;
  }

  try {
    await mkdir(defaultDir, { recursive: true });
    const content = JSON.stringify(report, null, 2);
    await writeFile(finalPath, content, "utf-8");
  } catch (err) {
    logWarn(`Could not write report to ${finalPath}: ${(err as Error).message}`);
  }
}
