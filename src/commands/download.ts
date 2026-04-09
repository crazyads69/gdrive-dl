import { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import cliProgress from "cli-progress";
import { getAuthClient, getAuthenticatedEmail } from "../lib/auth.ts";
import {
  extractFolderId,
  listFolderFiles,
  downloadFile,
  exportWorkspaceFile,
} from "../lib/drive.ts";
import {
  IS_TTY,
  logError,
  logInfo,
  logSpinner,
  logSuccess,
  logSummary,
  logWarn,
} from "../lib/logger.ts";
import { matchFiles, normalizeToNfc } from "../lib/matcher.ts";
import { writeReport } from "../lib/reporter.ts";
import { sanitizeOutputPath } from "../lib/sanitizer.ts";
import { getConfigDir } from "../lib/config.ts";
import { loadSettings } from "../lib/settings.ts";

interface DownloadItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  md5Hash?: string;
  path: string;
  matchedBy: "exact" | "fuzzy";
}

interface DownloadResult {
  name: string;
  status: "success" | "failed" | "skipped";
  bytesTransferred: number;
  resumed: boolean;
  retryCount: number;
  verified: boolean;
  error?: string;
}

export const downloadCommand = new Command("download")
  .description("Download files matching a name list from a Drive folder")
  .requiredOption("-u, --url <url>", "Google Drive folder URL or folder ID")
  .option("-f, --file <path>", "Text file with filenames, one per line")
  .option("-n, --names <names...>", "Inline filenames (space-separated)")
  .option("-o, --output <dir>", "Output directory", "./downloads")
  .option("-c, --concurrency <n>", "Parallel downloads")
  .option("-r, --retries <n>", "Retry failed downloads")
  .option("-y, --yes", "Skip confirmation prompt", false)
  .option("--recursive", "Search subfolders recursively", false)
  .option("--fuzzy", "Show fuzzy match suggestions for unmatched names", false)
  .option("--overwrite", "Overwrite existing files instead of skipping", false)
  .option("--resume", "Resume interrupted downloads (byte-range)", false)
  .option("--checksum", "Verify downloaded files with MD5", false)
  .option(
    "--dry-run",
    "Show what would be downloaded without downloading",
    false,
  )
  .option(
    "--report",
    "Write JSON report to file (default: true for download)",
    true,
  )
  .option("--report-path <file>", "Override default report path")
  .action(async (opts) => {
    const startTime = Date.now();
    const settings = loadSettings({ configDir: getConfigDir() });
    const cliConcurrency = opts.concurrency
      ? Number.parseInt(opts.concurrency)
      : NaN;
    const cliRetries = opts.retries ? Number.parseInt(opts.retries) : NaN;
    const concurrency = Math.min(
      8,
      Math.max(
        1,
        isNaN(cliConcurrency) ? settings.download.concurrency : cliConcurrency,
      ),
    );
    const retries = isNaN(cliRetries)
      ? settings.download.retries
      : Math.max(0, cliRetries);

    let names: string[] = [];
    if (opts.file) {
      if (!existsSync(opts.file)) {
        logError(`File not found: ${opts.file}`);
        process.exit(1);
      }
      const content = await readFile(opts.file, "utf-8");
      names = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#"));
    }
    if (opts.names) {
      names = [...names, ...opts.names];
    }
    names = [...new Set(names.map((n) => normalizeToNfc(n)))];

    if (names.length === 0) {
      logError("No filenames provided. Use --file or --names.");
      process.exit(1);
    }

    const folderId = extractFolderId(opts.url);
    const spinner = logSpinner("Listing files in folder...");

    try {
      const auth = await getAuthClient();
      const email = await getAuthenticatedEmail();
      const allFiles = await listFolderFiles(auth, folderId, {
        recursive: opts.recursive,
      });
      spinner.stop();

      const { matched, unmatched, fuzzyMatches } = matchFiles(allFiles, names, {
        fuzzy: opts.fuzzy,
      });

      if (matched.length === 0) {
        logWarn("No files matched. Nothing to download.");
        await writeReport(
          {
            status: "success",
            metadata: buildMetadata(email, opts, startTime),
            summary: {
              matched: 0,
              downloaded: 0,
              verified: 0,
              failed: 0,
              skipped: 0,
              notFound: names.length,
            },
            items: [],
            unmatched: names,
            fuzzySuggestions: fuzzyMatches,
          },
          opts.reportPath,
        );
        process.exit(3);
      }

      console.log(`\n✓ ${matched.length} file(s) matched:\n`);
      for (const m of matched) {
        const outPath = sanitizeOutputPath(join(opts.output, m.path, m.name));
        console.log(`  ${m.name} → ${outPath}`);
      }
      if (unmatched.length > 0) {
        console.log(`\n⚠ ${unmatched.length} name(s) not found:`);
        for (const u of unmatched) {
          const suggestion = fuzzyMatches.find((f) => f.name === u)
            ?.candidates[0];
          const hint = suggestion ? ` (did you mean: ${suggestion.name}?)` : "";
          console.log(`  ${u}${hint}`);
        }
      }

      if (!opts.yes && !opts.dryRun) {
        const answer = await promptConfirm(
          `Download ${matched.length} file(s) to ${opts.output}?`,
        );
        if (!answer) {
          console.log("Cancelled.");
          return;
        }
      }

      const results: DownloadResult[] = [];
      let downloaded = 0;
      let verified = 0;
      let failed = 0;
      let skipped = 0;

      if (!opts.dryRun) {
        const progressBar = new cliProgress.SingleBar(
          { format: "{bar} {percentage}% | {filename}", hideCursor: true },
          cliProgress.Presets.shades_classic,
        );
        if (IS_TTY) progressBar.start(matched.length, 0);
        let completed = 0;

        await runWithConcurrency(
          matched,
          concurrency,
          async (item: DownloadItem) => {
            const outputPath = sanitizeOutputPath(
              join(opts.output, item.path, item.name),
            );
            const exists = existsSync(outputPath);

            if (exists && !opts.overwrite) {
              skipped++;
              results.push({
                name: item.name,
                status: "skipped",
                bytesTransferred: 0,
                resumed: false,
                retryCount: 0,
                verified: false,
              });
              if (IS_TTY) progressBar.increment();
              else console.log(`  ${item.name}: skipped (exists)`);
              completed++;
              return;
            }

            let attempt = 0;
            let success = false;
            let bytesTransferred = 0;
            let isVerified = false;

            while (attempt <= retries && !success) {
              try {
                const isExport = item.mimeType.startsWith(
                  "application/vnd.google-apps",
                );
                const result = isExport
                  ? await exportWorkspaceFile(auth, item, outputPath)
                  : await downloadFile(auth, item, outputPath, {
                      overwrite: opts.overwrite,
                      resume: opts.resume,
                      checksum: opts.checksum,
                    });

                bytesTransferred = result.bytesTransferred ?? item.size;
                isVerified = result.verified ?? false;
                success = true;
              } catch (err) {
                attempt++;
                if (attempt > retries) {
                  failed++;
                  results.push({
                    name: item.name,
                    status: "failed",
                    bytesTransferred: 0,
                    resumed: false,
                    retryCount: attempt,
                    verified: false,
                    error: (err as Error).message,
                  });
                  if (!IS_TTY) console.log(`  ✗ ${item.name}: failed`);
                } else {
                  const delay =
                    1000 * Math.pow(2, attempt - 1) * (1 + Math.random() * 0.2);
                  await Bun.sleep(Math.floor(delay));
                }
              }
            }

            if (success) {
              downloaded++;
              if (isVerified) verified++;
              results.push({
                name: item.name,
                status: "success",
                bytesTransferred,
                resumed: opts.resume && exists,
                retryCount: attempt,
                verified: isVerified,
              });
            }

            completed++;
            if (IS_TTY) progressBar.update(completed, { filename: item.name });
          },
        );

        if (IS_TTY) progressBar.stop();
      }

      const durationMs = Date.now() - startTime;
      logSummary({
        downloaded,
        verified,
        failed,
        skipped,
        notFound: unmatched.length,
        outputDir: opts.output,
        durationMs,
      });

      const reportStatus =
        failed > 0 ? (downloaded > 0 ? "partial" : "aborted") : "success";
      await writeReport(
        {
          status: reportStatus,
          metadata: buildMetadata(email, opts, startTime),
          summary: {
            matched: matched.length,
            downloaded,
            verified,
            failed,
            skipped,
            notFound: unmatched.length,
          },
          items: results.map((r, i) => ({
            id: matched[i].id,
            name: matched[i].name,
            mimeType: matched[i].mimeType,
            size: matched[i].size,
            outputPath: sanitizeOutputPath(
              join(opts.output, matched[i].path, matched[i].name),
            ),
            matchedBy: matched[i].matchedBy,
            status: r.status,
            bytesTransferred: r.bytesTransferred,
            resumed: r.resumed,
            retryCount: r.retryCount,
            checksum: {
              enabled: opts.checksum,
              algorithm: "md5",
              verified: r.verified,
              reason: undefined,
            },
            error: r.error ? { message: r.error } : undefined,
          })),
          unmatched,
          fuzzySuggestions: fuzzyMatches,
        },
        opts.reportPath,
      );

      if (failed > 0) process.exit(2);
    } catch (err) {
      spinner.stop();
      logError(`Fatal error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

function buildMetadata(
  email: string | null,
  opts: Record<string, unknown>,
  startTime: number,
) {
  return {
    tool: "gdrive-dl",
    version: "1.2.0",
    runtime: "bun",
    command: "download",
    startTime: new Date(startTime).toISOString(),
    endTime: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    userEmail: email,
    args: {
      url: String(opts.url),
      outputDir: String(opts.output),
      recursive: Boolean(opts.recursive),
      concurrency: Number.parseInt(String(opts.concurrency)),
      retries: Number.parseInt(String(opts.retries)),
      overwrite: Boolean(opts.overwrite),
      resume: Boolean(opts.resume),
      checksum: Boolean(opts.checksum),
      fuzzy: Boolean(opts.fuzzy),
      dryRun: Boolean(opts.dryRun),
      fileSource: opts.file ? String(opts.file) : undefined,
      namesCount: opts.names ? (opts.names as string[]).length : undefined,
    },
  };
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const active: Promise<void>[] = [];

  while (queue.length > 0 || active.length > 0) {
    while (queue.length > 0 && active.length < limit) {
      const item = queue.shift()!;
      const promise = fn(item).finally(() => {
        const idx = active.indexOf(promise);
        if (idx !== -1) active.splice(idx, 1);
      });
      active.push(promise);
    }
    if (active.length > 0) {
      await Promise.race(active);
    }
  }
}

async function promptConfirm(message: string): Promise<boolean> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${message} (Y/n) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() !== "n");
    });
  });
}
