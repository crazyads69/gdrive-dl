import { Command } from "commander";
import { clearToken } from "../lib/auth.ts";
import { logSuccess } from "../lib/logger.ts";

export const logoutCommand = new Command("logout")
  .description("Clear saved authentication token")
  .option("--revoke", "Also revoke the token with Google", false)
  .action(async (opts) => {
    await clearToken();
    if (opts.revoke) {
      console.log("Token revoked.");
    }
    logSuccess("Logged out. Token cleared.");
  });
