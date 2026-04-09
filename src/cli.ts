#!/usr/bin/env bun
import { Command } from "commander";
import { authCommand } from "./commands/auth.ts";
import { downloadCommand } from "./commands/download.ts";
import { listCommand } from "./commands/list.ts";
import { logoutCommand } from "./commands/logout.ts";
import { VERSION } from "./constants.ts";

const program = new Command();

program
  .name("gdrive-dl")
  .version(VERSION)
  .description("Batch download files from Google Drive by filename");

program.addCommand(authCommand);
program.addCommand(logoutCommand);
program.addCommand(listCommand);
program.addCommand(downloadCommand);

program.parse();
