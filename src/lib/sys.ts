import { statfs } from "node:fs/promises";

/**
 * Checks if the target directory has enough free disk space for the required bytes.
 * Fallbacks to true if `statfs` is unsupported by the runtime/OS to avoid breaking downloads.
 */
export async function checkDiskSpace(dirPath: string, requiredBytes: number): Promise<boolean> {
  if (requiredBytes <= 0) return true;

  try {
    const stats = await statfs(dirPath);
    // stats.bavail = free blocks available to unprivileged user
    // stats.bsize = fundamental file system block size
    const availableBytes = stats.bavail * stats.bsize;

    // Add a 5% buffer to be safe
    return availableBytes > requiredBytes * 1.05;
  } catch (err) {
    // If the platform/fs doesn't support statfs, don't fail the CLI.
    // Just return true and let the OS handle out-of-space errors during writing.
    return true;
  }
}
