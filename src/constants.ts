import pkg from "../package.json";

export const OAUTH_DEFAULTS = {
  scopes: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
  redirectUri: "http://localhost",
} as const;

export const CONFIG_DIR = "gdrive-dl";
export const TOKEN_FILE = "token.json";
export const REPORTS_DIR = "reports";

export const VERSION = pkg.version;
