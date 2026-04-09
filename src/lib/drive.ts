import type { OAuth2Client } from "google-auth-library";

export interface DriveFile {
  id: string;
  name: string;
  size: string | number;
  mimeType: string;
  md5Hash?: string | null;
  modifiedTime?: string | null;
  parents?: string[] | null;
  path: string;
}

export interface ListOptions {
  recursive?: boolean;
}

export interface DownloadOptions {
  overwrite?: boolean;
  resume?: boolean;
  checksum?: boolean;
}

export interface DownloadResult {
  bytesTransferred: number;
  verified?: boolean;
  error?: string;
  status: "success" | "failed";
}

export function extractFolderId(input: string): string {
  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /id=([a-zA-Z0-9_-]+)/,
    /^([a-zA-Z0-9_-]{10,})$/,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }

  throw new Error(`Cannot extract folder ID from: ${input}`);
}

export function isGoogleWorkspaceFile(mimeType: string): boolean {
  return mimeType.startsWith("application/vnd.google-apps");
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  maxTimeoutMs = 300_000,
): Promise<T> {
  if (maxRetries < 0) {
    throw new Error("maxRetries must be >= 0");
  }
  const startTime = Date.now();
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      const elapsed = Date.now() - startTime;
      const shouldRetry = attempt <= maxRetries && elapsed < maxTimeoutMs;
      const isRetryableError =
        err.code === 403 || err.code === 429 || err.code >= 500;
      if (shouldRetry && isRetryableError) {
        const delay = 2 ** attempt * 1000 + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
}

export async function listFolderFiles(
  auth: OAuth2Client,
  folderId: string,
  options: ListOptions = {},
): Promise<DriveFile[]> {
  const { google } = await import("googleapis");
  const drive = google.drive({ version: "v3", auth });
  const files: DriveFile[] = [];
  const queue: string[] = [folderId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;
    let pageToken: string | undefined;

    do {
      const response = await withRetry(() =>
        drive.files.list(
          {
            q: `'${currentId}' in parents and trashed = false`,
            fields:
              "nextPageToken, files(id, name, size, mimeType, md5Checksum, modifiedTime, parents, shortcutDetails)",
            pageSize: 1000,
            pageToken,
          },
          { timeout: 30000 },
        ),
      );

      for (const file of response.data.files ?? []) {
        if (file.mimeType === "application/vnd.google-apps.shortcut") {
          // Resolve shortcut if it points to a folder or file
          if (file.shortcutDetails?.targetId) {
            if (
              file.shortcutDetails.targetMimeType ===
              "application/vnd.google-apps.folder"
            ) {
              if (options.recursive) queue.push(file.shortcutDetails.targetId);
            } else {
              files.push({
                id: file.shortcutDetails.targetId,
                name: file.name ?? "unknown",
                size: "0", // Unknown size for shortcuts until resolved
                mimeType:
                  file.shortcutDetails.targetMimeType ??
                  "application/octet-stream",
                md5Hash: null,
                modifiedTime: file.modifiedTime,
                parents: file.parents,
                path: "",
              });
            }
          }
          continue;
        }

        if (file.mimeType === "application/vnd.google-apps.folder") {
          if (options.recursive && file.id) {
            queue.push(file.id);
          }
        } else {
          files.push({
            id: file.id ?? "",
            name: file.name ?? "unknown",
            size: file.size ?? "0",
            mimeType: file.mimeType ?? "application/octet-stream",
            md5Hash: file.md5Checksum,
            modifiedTime: file.modifiedTime,
            parents: file.parents,
            path: "",
          });
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  return files;
}

export async function downloadFile(
  auth: OAuth2Client,
  file: DriveFile,
  outputPath: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const { google } = await import("googleapis");
  const drive = google.drive({ version: "v3", auth });
  const { createWriteStream, existsSync } = await import("node:fs");
  const {
    stat: statProm,
    writeFile: writeFileProm,
    mkdir,
  } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const { pipeline } = await import("node:stream/promises");
  const { Transform } = await import("node:stream");

  let startByte = 0;
  const headers: Record<string, string> = {};

  if (options.resume && existsSync(outputPath)) {
    const stats = await statProm(outputPath);
    if (stats.size > 0 && !isGoogleWorkspaceFile(file.mimeType)) {
      const targetSize = Number(file.size);

      // If the file is already fully downloaded, skip downloading
      if (targetSize > 0 && stats.size >= targetSize) {
        let verified = false;
        if (options.checksum && file.md5Hash) {
          verified = await verifyMd5(outputPath, file.md5Hash);
          if (!verified) {
            // Checksum mismatch on a "fully" downloaded file, we must re-download from scratch
            startByte = 0;
          } else {
            return { bytesTransferred: 0, verified: true, status: "success" };
          }
        } else {
          return { bytesTransferred: 0, verified: false, status: "success" };
        }
      } else {
        startByte = Number(stats.size);
        headers.Range = `bytes=${startByte}-`;
      }
    }
  }

  const response = await withRetry(() =>
    drive.files.get(
      { fileId: file.id, alt: "media" },
      { headers, responseType: "stream" },
    ),
  );

  let downloadedBytes = startByte;

  const writeMode = startByte > 0 ? "a" : "w";
  await mkdir(dirname(outputPath), { recursive: true });
  const fileHandle = createWriteStream(outputPath, { flags: writeMode });

  const tracker = new Transform({
    transform(chunk, encoding, callback) {
      downloadedBytes += chunk.length;
      this.push(chunk);
      callback();
    },
  });

  await pipeline(response.data, tracker, fileHandle);

  let verified = false;
  if (options.checksum && file.md5Hash) {
    verified = await verifyMd5(outputPath, file.md5Hash);
    if (!verified) {
      await writeFileProm(outputPath, "");
      throw new Error("Checksum mismatch");
    }
  }

  return { bytesTransferred: downloadedBytes, verified, status: "success" };
}

export async function exportWorkspaceFile(
  auth: OAuth2Client,
  file: DriveFile,
  outputPath: string,
): Promise<DownloadResult> {
  const { google } = await import("googleapis");
  const drive = google.drive({ version: "v3", auth });
  const { createWriteStream } = await import("node:fs");
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const { pipeline } = await import("node:stream/promises");

  const EXPORT_MIME_TYPES: Record<string, string> = {
    "application/vnd.google-apps.document": "application/pdf",
    "application/vnd.google-apps.spreadsheet":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.xlsx",
    "application/vnd.google-apps.presentation": "application/pdf",
  };

  const exportMime = EXPORT_MIME_TYPES[file.mimeType];
  if (!exportMime) {
    return {
      bytesTransferred: 0,
      status: "failed",
      error: `Unsupported export type: ${file.mimeType}`,
    };
  }

  const response = await withRetry(() =>
    drive.files.export(
      { fileId: file.id, mimeType: exportMime },
      { responseType: "stream" },
    ),
  );

  await mkdir(dirname(outputPath), { recursive: true });
  const fileHandle = createWriteStream(outputPath);

  await pipeline(response.data, fileHandle);

  return {
    bytesTransferred: Number(file.size) || 0,
    verified: false,
    status: "success",
  };
}

export async function verifyMd5(
  filePath: string,
  expectedMd5: string,
): Promise<boolean> {
  const { createHash } = await import("node:crypto");
  const { createReadStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");

  const hash = createHash("md5");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex") === expectedMd5;
}
