import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR } from "../constants.ts";

export function getConfigDir(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, CONFIG_DIR);
}

export function getTokenPath(): string {
  return join(getConfigDir(), "token");
}

export function getConfigFilePath(): string {
  return join(getConfigDir(), "config.json");
}

export function getReportsDir(): string {
  return join(getConfigDir(), "reports");
}
