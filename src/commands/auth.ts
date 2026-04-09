import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { input, password } from "@inquirer/prompts";
import { Command } from "commander";
import { authenticate, getAuthenticatedEmail } from "../lib/auth.ts";
import { getConfigDir, getConfigFilePath } from "../lib/config.ts";
import { logError, logInfo, logSuccess } from "../lib/logger.ts";
import { loadSettings } from "../lib/settings.ts";

async function runSetup(): Promise<void> {
  const configDir = getConfigDir();
  const configPath = getConfigFilePath();
  await mkdir(configDir, { recursive: true });

  let currentClientId = "";
  let currentClientSecret = "";

  try {
    const existing = loadSettings({ configDir });
    currentClientId = existing.oauth.clientId;
    currentClientSecret = existing.oauth.clientSecret;
  } catch {
    // no config yet, use defaults
  }

  logInfo("Setting up gdrive-dl configuration...\n");

  const clientId = await input({
    message: "OAuth Client ID:",
    default: currentClientId,
    validate: (v) => v.trim().length > 0 || "Client ID is required",
  });

  const clientSecret = await password({
    message: "OAuth Client Secret:",
    default: currentClientSecret,
    mask: true,
    validate: (v) => v.trim().length > 0 || "Client Secret is required",
  });

  const config = {
    oauth: {
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      redirectUri: "http://localhost",
    },
    download: {
      concurrency: 3,
      retries: 2,
    },
  };

  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  logSuccess(`Configuration saved to ${configPath}\n`);
}

export const authCommand = new Command("auth")
  .description("Authenticate with Google Drive via browser")
  .option("-f, --force", "Re-authenticate even if a valid token exists", false)
  .option("-s, --setup", "Interactive first-time setup (configure OAuth credentials)", false)
  .action(async (opts) => {
    try {
      if (opts.setup) {
        await runSetup();
        logInfo("Now authenticating...\n");
      }

      const existingEmail = await getAuthenticatedEmail();
      if (existingEmail && !opts.force) {
        logSuccess(`Already authenticated as ${existingEmail}`);
        return;
      }
      await authenticate(opts.force);
      const email = await getAuthenticatedEmail();
      if (email) {
        logSuccess(`Authenticated as ${email}`);
      }
    } catch (err) {
      logError(`Authentication failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });
