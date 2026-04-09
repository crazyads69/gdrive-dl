import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const TEMP_CONFIG = "/tmp/gdrive-dl-test-config";

async function cleanConfig() {
  try {
    await Bun.file(`${TEMP_CONFIG}/config.json`).delete();
  } catch (_) {
    // ignore
  }
  try {
    await Bun.file(`${TEMP_CONFIG}/token.json`).delete();
  } catch (_) {
    // ignore
  }
}

describe("settings", () => {
  beforeEach(async () => {
    await cleanConfig();
  });
  afterEach(async () => {
    await cleanConfig();
  });

  test("loads defaults when no config file exists", async () => {
    delete process.env.GDRIVEDL_OAUTH_CLIENT_ID;
    delete process.env.GDRIVEDL_OAUTH_CLIENT_SECRET;

    const { loadSettings } = await import("../src/lib/settings");
    expect(() => loadSettings({ configDir: TEMP_CONFIG })).toThrow("Missing OAuth credentials");
  });

  test("config file values override defaults", async () => {
    delete process.env.GDRIVEDL_OAUTH_CLIENT_ID;
    delete process.env.GDRIVEDL_OAUTH_CLIENT_SECRET;
    await Bun.write(
      `${TEMP_CONFIG}/config.json`,
      JSON.stringify({
        oauth: { clientId: "config-id", clientSecret: "config-secret" },
      })
    );

    const { loadSettings } = await import("../src/lib/settings");
    const settings = loadSettings({ configDir: TEMP_CONFIG });
    expect(settings.oauth.clientId).toBe("config-id");
    expect(settings.oauth.clientSecret).toBe("config-secret");
  });

  test("env vars override config file", async () => {
    await Bun.write(
      `${TEMP_CONFIG}/config.json`,
      JSON.stringify({
        oauth: { clientId: "config-id", clientSecret: "config-secret" },
      })
    );
    process.env.GDRIVEDL_OAUTH_CLIENT_ID = "env-id";
    process.env.GDRIVEDL_OAUTH_CLIENT_SECRET = "env-secret";

    const { loadSettings } = await import("../src/lib/settings");
    const settings = loadSettings({ configDir: TEMP_CONFIG });
    expect(settings.oauth.clientId).toBe("env-id");
    expect(settings.oauth.clientSecret).toBe("env-secret");

    delete process.env.GDRIVEDL_OAUTH_CLIENT_ID;
    delete process.env.GDRIVEDL_OAUTH_CLIENT_SECRET;
  });

  test("throws error when oauth credentials are missing", async () => {
    delete process.env.GDRIVEDL_OAUTH_CLIENT_ID;
    delete process.env.GDRIVEDL_OAUTH_CLIENT_SECRET;
    await Bun.write(`${TEMP_CONFIG}/config.json`, JSON.stringify({ oauth: {} }));

    const { loadSettings } = await import("../src/lib/settings");
    expect(() => loadSettings({ configDir: TEMP_CONFIG })).toThrow("Missing OAuth credentials");
  });
});
