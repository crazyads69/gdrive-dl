export const OAUTH_DEFAULTS = {
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  redirectUri: "http://localhost",
} as const;

export const CONFIG_DIR = "gdrive-dl";
export const TOKEN_FILE = "token.json";
export const REPORTS_DIR = "reports";

export const VERSION = "1.2.0";
