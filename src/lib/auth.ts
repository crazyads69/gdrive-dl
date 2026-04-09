import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import { OAUTH_DEFAULTS } from "../constants.ts";
import { getConfigDir, getTokenPath } from "./config.ts";
import { logError, logInfo, logSuccess } from "./logger.ts";
import { loadSettings } from "./settings.ts";

const HTML_AUTH_SUCCESS = `<!DOCTYPE html>
<html>
<head><title>gdrive-dl</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0f0f0">
<div style="text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.1)">
  <div style="font-size:48px;margin-bottom:16px">✓</div>
  <h2 style="margin:0 0 8px;color:#1a1a1a">Authenticated!</h2>
  <p style="margin:0;color:#666">You can close this window and return to the terminal.</p>
</div>
</body>
</html>`;

const HTML_AUTH_FAILED = `<!DOCTYPE html>
<html>
<head><title>gdrive-dl - Auth Failed</title></head>
<body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0f0f0">
<div style="text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.1)">
  <div style="font-size:48px;margin-bottom:16px">✗</div>
  <h2 style="margin:0 0 8px;color:#dc2626">Auth Failed</h2>
  <p style="margin:0;color:#666">Close this window and try again.</p>
</div>
</body>
</html>`;

export interface SavedToken {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expiry_date: number;
  email?: string;
}

function isExpired(token: SavedToken): boolean {
  return Date.now() >= token.expiry_date - 60_000;
}

async function loadToken(): Promise<SavedToken | null> {
  try {
    const path = getTokenPath();
    if (!existsSync(path)) return null;
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as SavedToken;
  } catch {
    return null;
  }
}

async function saveToken(token: SavedToken): Promise<void> {
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true });
  const path = getTokenPath();
  await writeFile(path, JSON.stringify(token, null, 2), "utf-8");
}

function createOAuth2Client(): OAuth2Client {
  const { oauth } = loadSettings({ configDir: getConfigDir() });
  return new google.auth.OAuth2(oauth.clientId, oauth.clientSecret, oauth.redirectUri);
}

async function openBrowserAndWaitForCode(authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          reject(new Error(`Auth denied: ${error}`));
          server.stop();
          return new Response(HTML_AUTH_FAILED, {
            headers: { "Content-Type": "text/html" },
          });
        }

        if (code) {
          resolve(code);
          setTimeout(() => server.stop(), 1000);
          return new Response(HTML_AUTH_SUCCESS, {
            headers: { "Content-Type": "text/html" },
          });
        }

        return new Response("Waiting for auth...", { status: 200 });
      },
    });

    const redirectUri = `http://localhost:${server.port}`;
    const finalUrl = authUrl.replace(/^http:\/\/localhost/, redirectUri);

    const cmd =
      process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    const proc = Bun.spawn([cmd, finalUrl]);
    void proc;
  });
}

async function startInteractiveAuth(client: OAuth2Client): Promise<OAuth2Client> {
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: [...OAUTH_DEFAULTS.scopes],
    prompt: "consent",
  });

  logInfo("Opening browser for Google login...");
  const code = await openBrowserAndWaitForCode(authUrl);
  const { tokens } = await client.getToken(code);

  const saved: SavedToken = {
    access_token: tokens.access_token ?? "",
    refresh_token: tokens.refresh_token ?? undefined,
    token_type: tokens.token_type ?? "Bearer",
    expiry_date: tokens.expiry_date ?? Date.now(),
    email: tokens.id_token ? (parseIdToken(tokens.id_token).email ?? undefined) : undefined,
  };

  await saveToken(saved);
  client.setCredentials(saved);
  return client;
}

interface IdTokenPayload {
  email?: string;
  name?: string;
}

function parseIdToken(idToken: string): IdTokenPayload {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return {};
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    return payload as IdTokenPayload;
  } catch {
    return {};
  }
}

export async function authenticate(force = false): Promise<OAuth2Client> {
  const client = createOAuth2Client();
  const saved = await loadToken();

  if (saved && !force) {
    client.setCredentials(saved);
    if (isExpired(saved)) {
      try {
        logInfo("Refreshing access token...");
        const { credentials } = await client.refreshAccessToken();
        const updated: SavedToken = {
          access_token: credentials.access_token ?? "",
          refresh_token: credentials.refresh_token ?? saved.refresh_token,
          token_type: credentials.token_type ?? "Bearer",
          expiry_date: credentials.expiry_date ?? Date.now(),
          email: saved.email,
        };
        await saveToken(updated);
        client.setCredentials(updated);
        logSuccess("Token refreshed automatically.");
        return client;
      } catch {
        logInfo("Session expired. Re-authenticating...");
        return await startInteractiveAuth(client);
      }
    }
    return client;
  }

  return await startInteractiveAuth(client);
}

export async function getAuthClient(): Promise<OAuth2Client> {
  return await authenticate();
}

export async function getAuthenticatedEmail(): Promise<string | null> {
  const token = await loadToken();
  return token?.email ?? null;
}

export async function clearToken(): Promise<void> {
  const path = getTokenPath();
  if (existsSync(path)) {
    const { unlink } = await import("node:fs/promises");
    await unlink(path);
  }
}
