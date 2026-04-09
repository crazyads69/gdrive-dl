import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface OAuthSettings {
  clientId: string;
  clientSecret: string;
  scopes: readonly string[];
  redirectUri: string;
}

export interface DownloadSettings {
  concurrency: number;
  retries: number;
}

export interface Settings {
  oauth: OAuthSettings;
  download: DownloadSettings;
}

interface RawConfig {
  oauth?: Partial<OAuthSettings>;
  download?: Partial<DownloadSettings>;
}

const DEFAULTS: Settings = {
  oauth: {
    clientId: "",
    clientSecret: "",
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    redirectUri: "http://localhost:8000",
  },
  download: {
    concurrency: 3,
    retries: 2,
  },
} as const;

function getEnv(key: string): string | undefined {
  return process.env[key] ?? undefined;
}

export function loadSettings(opts: { configDir: string }): Settings {
  const configPath = join(opts.configDir, "config.json");
  let raw: RawConfig = {};

  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      raw = JSON.parse(content) as RawConfig;
    } catch {
      // ignore malformed config
    }
  }

  const oauth: OAuthSettings = {
    clientId: getEnv("GDRIVEDL_OAUTH_CLIENT_ID") ?? raw.oauth?.clientId ?? DEFAULTS.oauth.clientId,
    clientSecret:
      getEnv("GDRIVEDL_OAUTH_CLIENT_SECRET") ??
      raw.oauth?.clientSecret ??
      DEFAULTS.oauth.clientSecret,
    scopes: raw.oauth?.scopes ?? DEFAULTS.oauth.scopes,
    redirectUri: raw.oauth?.redirectUri ?? DEFAULTS.oauth.redirectUri,
  };

  const download: DownloadSettings = {
    concurrency: raw.download?.concurrency ?? DEFAULTS.download.concurrency,
    retries: raw.download?.retries ?? DEFAULTS.download.retries,
  };

  if (!oauth.clientId || !oauth.clientSecret) {
    throw new Error(
      "Missing OAuth credentials. Set them in config.json or via GDRIVEDL_OAUTH_CLIENT_ID / GDRIVEDL_OAUTH_CLIENT_SECRET"
    );
  }

  return { oauth, download } as Settings;
}
