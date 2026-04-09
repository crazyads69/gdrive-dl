import { isatty } from "node:tty";
import chalk from "chalk";

export const IS_TTY = isatty(1);

type LogLevel = "info" | "warn" | "error" | "success";

const PREFIX: Record<LogLevel, string> = {
  info: chalk.cyan("ℹ"),
  warn: chalk.yellow("⚠"),
  error: chalk.red("✗"),
  success: chalk.green("✓"),
};

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function log(level: LogLevel, message: string): void {
  console.error(`${PREFIX[level]} ${message}`);
}

export function logInfo(message: string): void {
  log("info", message);
}

export function logWarn(message: string): void {
  log("warn", message);
}

export function logError(message: string): void {
  log("error", message);
}

export function logSuccess(message: string): void {
  log("success", message);
}

export function logDownloadProgress(
  name: string,
  percent: number,
  speed: number,
  size: number
): void {
  const barWidth = 20;
  const filled = Math.round((percent / 100) * barWidth);
  const empty = barWidth - filled;
  const bar = chalk.green("█".repeat(filled)) + chalk.gray("░".repeat(empty));
  const speedStr = speed > 0 ? `${formatSize(speed)}/s` : "";
  console.error(
    `  ${bar} ${percent.toFixed(0).padStart(3)}% | ${name} (${formatSize(size)}) ${speedStr}`
  );
}

export function logDownloadComplete(name: string, size: number, verified: boolean): void {
  const verifiedStr = verified ? chalk.green(" ✓ verified") : "";
  console.error(`  ${chalk.green("✓")} ${name} (${formatSize(size)})${verifiedStr}`);
}

export function logSummary(stats: {
  downloaded: number;
  verified: number;
  failed: number;
  skipped: number;
  notFound: number;
  outputDir: string;
  durationMs: number;
}): void {
  console.error(chalk.bold("\n── Summary ──"));
  if (stats.downloaded > 0) {
    console.error(`  ${chalk.green("✓")} Downloaded: ${stats.downloaded}`);
  }
  if (stats.verified > 0) {
    console.error(`  ${chalk.green("✓")} Verified:   ${stats.verified}`);
  }
  if (stats.skipped > 0) {
    console.error(`  ${chalk.yellow("⚠")} Skipped:   ${stats.skipped}`);
  }
  if (stats.failed > 0) {
    console.error(`  ${chalk.red("✗")} Failed:    ${stats.failed}`);
  }
  if (stats.notFound > 0) {
    console.error(`  ${chalk.yellow("⚠")} Not found: ${stats.notFound}`);
  }
  console.error(`  ${chalk.gray("📂")} Output:    ${stats.outputDir}`);
  console.error(`  ${chalk.gray("⏱")} Duration:  ${formatDuration(stats.durationMs)}`);
}

export function logSpinner(message: string): {
  stop: (finalMsg?: string) => void;
} {
  if (!IS_TTY) {
    console.error(message);
    return { stop: () => {} };
  }
  const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];
  let i = 0;
  const interval = setInterval(() => {
    process.stderr.write(`\r${spinner[i++ % spinner.length]} ${message}`);
  }, 80);
  return {
    stop: (finalMsg?: string) => {
      clearInterval(interval);
      process.stderr.write("\r\x1b[K"); // clear line
      if (finalMsg) console.error(finalMsg);
    },
  };
}
