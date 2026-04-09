import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import cliProgress from "cli-progress";
import { Command } from "commander";
import { getAuthClient, getAuthenticatedEmail } from "../lib/auth.ts";
import { getConfigDir } from "../lib/config.ts";
import {
  downloadFile,
  exportWorkspaceFile,
  extractFolderId,
  listFolderFiles,
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
import { sanitizeOutputPath, sanitizePathSegment } from "../lib/sanitizer.ts";
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
  .option("--dry-run", "Show what would be downloaded without downloading", false)
  .option("--report", "Write JSON report to file (default: true for download)", true)
  .option("--report-path <file>", "Override default report path")
  .action(async (opts) => {
    const startTime = Date.now();
    const settings = loadSettings({ configDir: getConfigDir() });
    const cliConcurrency = opts.concurrency ? Number.parseInt(opts.concurrency, 10) : Number.NaN;
    const cliRetries = opts.retries ? Number.parseInt(opts.retries, 10) : Number.NaN;
    const concurrency = Math.min(
      8,
      Math.max(1, Number.isNaN(cliConcurrency) ? settings.download.concurrency : cliConcurrency)
    );
    const retries = Number.isNaN(cliRetries)
      ? settings.download.retries
      : Math.max(0, Math.min(10, cliRetries));

    let names: string[] = [];
    if (opts.file) {
      if (!existsSync(opts.file)) {
        logError(`File not found: ${opts.file}`);
        process.exitCode = 1;
        return;
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
      process.exitCode = 1;
      return;
    }

    let isAborting = false;
    const handleSignal = () => {
      isAborting = true;
    };
    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);

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
          opts.reportPath
        );
        process.exitCode = 3;
        return;
      }

      console.error(`\n✓ ${matched.length} file(s) matched:\n`);
      for (const m of matched) {
        const outPath = join(opts.output, sanitizeOutputPath(m.path), sanitizePathSegment(m.name));
        console.error(`  ${m.name} → ${outPath}`);
      }
      if (unmatched.length > 0) {
        console.error(`\n⚠ ${unmatched.length} name(s) not found:`);
        for (const u of unmatched) {
          const suggestion = fuzzyMatches.find((f) => f.name === u)?.candidates[0];
          const hint = suggestion ? ` (did you mean: ${suggestion.name}?)` : "";
          console.error(`  ${u}${hint}`);
        }
      }

      // Check available disk space before proceeding
      const { checkDiskSpace } = await import("../lib/sys.ts");
      const totalRequiredBytes = matched.reduce((sum, m) => sum + Number(m.size || 0), 0);
      const outputDir = resolve(opts.output);
      await mkdir(outputDir, { recursive: true });

      const hasEnoughSpace = await checkDiskSpace(outputDir, totalRequiredBytes);
      if (!hasEnoughSpace) {
        logError(
          `Not enough disk space. Required: ${(totalRequiredBytes / 1024 / 1024).toFixed(1)}MB.`
        );
        process.exitCode = 1;
        return;
      }

      if (!opts.yes && !opts.dryRun) {
        const answer = await promptConfirm(`Download ${matched.length} file(s) to ${opts.output}?`);
        if (!answer) {
          console.error("Cancelled.");
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
          cliProgress.Presets.shades_classic
        );
        if (IS_TTY) progressBar.start(matched.length, 0);
        let completed = 0;

        await runWithConcurrency(
          matched,
          concurrency,
          async (item: DownloadItem) => {
            if (isAborting) return;
            const outputPath = join(
              opts.output,
              sanitizeOutputPath(item.path),
              sanitizePathSegment(item.name)
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
              else console.error(`  ${item.name}: skipped (exists)`);
              completed++;
              return;
            }

            let attempt = 0;
            let success = false;
            let bytesTransferred = 0;
            let isVerified = false;

            while (attempt <= retries && !success && !isAborting) {
              try {
                const isExport = item.mimeType.startsWith("application/vnd.google-apps");
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
                  if (!IS_TTY) console.error(`  ✗ ${item.name}: failed`);
                } else {
                  const delay = 1000 * 2 ** (attempt - 1) * (1 + Math.random() * 0.2);
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
          () => isAborting
        );

        if (IS_TTY) progressBar.stop();
      }

      const durationMs = Date.now() - startTime;
      if (isAborting) {
        logWarn("\nDownload aborted by user.");
      }
      logSummary({
        downloaded,
        verified,
        failed,
        skipped,
        notFound: unmatched.length,
        outputDir: opts.output,
        durationMs,
      });

      const reportStatus = isAborting
        ? "aborted"
        : failed > 0
          ? downloaded > 0
            ? "partial"
            : "failed"
          : "success";
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
            outputPath: join(
              opts.output,
              sanitizeOutputPath(matched[i].path),
              sanitizePathSegment(matched[i].name)
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
        opts.reportPath
      );

      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);

      if (isAborting) {
        process.exitCode = 130;
        return;
      }
      if (failed > 0) {
        process.exitCode = 2;
      }
    } catch (err) {
      spinner.stop();
      logError(`Fatal error: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

function buildMetadata(email: string | null, opts: Record<string, unknown>, startTime: number) {
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
  checkAbort?: () => boolean
): Promise<void> {
  const queue = [...items];
  const active: Promise<void>[] = [];

  while (queue.length > 0 || active.length > 0) {
    if (checkAbort?.()) {
      queue.length = 0;
    }
    while (queue.length > 0 && active.length < limit) {
      const item = queue.shift();
      if (!item) continue;
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
