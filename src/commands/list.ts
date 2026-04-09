import { Command, Option } from "commander";
import { getAuthClient } from "../lib/auth.ts";
import { extractFolderId, listFolderFiles } from "../lib/drive.ts";
import { logInfo, logWarn } from "../lib/logger.ts";

export const listCommand = new Command("list")
  .description("List all files in a Drive folder")
  .requiredOption("-u, --url <url>", "Google Drive folder URL or folder ID")
  .addOption(new Option("-s, --search <term>").hideHelp())
  .addOption(new Option("--type <ext>").hideHelp())
  .addOption(new Option("--recursive").hideHelp())
  .addOption(new Option("--json").hideHelp())
  .addOption(new Option("--count").hideHelp())
  .action(async (opts) => {
    try {
      const auth = await getAuthClient();
      const folderId = extractFolderId(opts.url);

      logInfo(`Listing files in folder...`);
      const files = await listFolderFiles(auth, folderId, { recursive: false });

      if (opts.json) {
        const output = files.map((f) => ({
          id: f.id,
          name: f.name,
          size: f.size,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
          path: f.path,
        }));
        console.log(JSON.stringify(output, null, 2));
      } else if (opts.count) {
        console.log(`${files.length} file(s) found`);
      } else {
        console.log(`\nFound ${files.length} file(s):\n`);
        for (const file of files.slice(0, 50)) {
          const size =
            file.size > 0 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "—";
          console.log(
            `  ${file.name.padEnd(40)} ${size.padEnd(10)} ${file.mimeType}`,
          );
        }
        if (files.length > 50) {
          console.log(`  ... and ${files.length - 50} more`);
        }
      }
    } catch (err) {
      logWarn(`Failed to list files: ${(err as Error).message}`);
      process.exit(1);
    }
  });
