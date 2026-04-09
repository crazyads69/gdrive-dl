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
    const currentId = queue.shift()!;
    let pageToken: string | undefined;

    do {
      const response = await drive.files.list({
        q: `'${currentId}' in parents`,
        fields:
          "nextPageToken, files(id, name, size, mimeType, md5Checksum, modifiedTime, parents)",
        pageSize: 1000,
        pageToken,
      });

      for (const file of response.data.files ?? []) {
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
  const { stat: statProm, writeFile: writeFileProm } =
    await import("node:fs/promises");

  let startByte = 0;
  const headers: Record<string, string> = {};

  if (options.resume && existsSync(outputPath)) {
    const stats = await statProm(outputPath);
    if (stats.size > 0 && !isGoogleWorkspaceFile(file.mimeType)) {
      startByte = Number(stats.size);
      headers["Range"] = `bytes=${startByte}-`;
    }
  }

  const response = await drive.files.get(
    { fileId: file.id, alt: "media" },
    { headers, responseType: "stream" },
  );

  let downloadedBytes = startByte;

  const writeMode = startByte > 0 ? "a" : "w";
  const fileHandle = createWriteStream(outputPath, { flags: writeMode });

  await new Promise<void>((resolve, reject) => {
    response.data.on("data", (chunk: Buffer) => {
      downloadedBytes += chunk.length;
    });
    response.data.pipe(fileHandle);
    response.data.on("end", () => resolve());
    response.data.on("error", (err: Error) => reject(err));
    fileHandle.on("error", (err: Error) => reject(err));
  });

  await new Promise<void>((resolve, reject) => {
    fileHandle.on("finish", () => resolve());
    fileHandle.on("error", (err: Error) => reject(err));
    fileHandle.end();
  });

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

  const response = await drive.files.export(
    { fileId: file.id, mimeType: exportMime },
    { responseType: "stream" },
  );

  const fileHandle = createWriteStream(outputPath);

  await new Promise<void>((resolve, reject) => {
    response.data.pipe(fileHandle);
    response.data.on("end", () => resolve());
    response.data.on("error", (err: Error) => reject(err));
    fileHandle.on("error", (err: Error) => reject(err));
  });

  await new Promise<void>((resolve) => {
    fileHandle.end(() => resolve());
  });

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
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(filePath);
  const hash = createHash("md5").update(content).digest("hex");
  return hash === expectedMd5;
}
