# gdrive-dl — Spec-Driven Development Document

> **CLI tool to batch download files from a Google Drive shared folder by filename**
>
> Version: 1.2.0 | Runtime: Bun | Language: TypeScript

---

## 1. Problem Statement

You have a Google Drive shared folder containing hundreds (or thousands) of image files. You have a list of specific filenames you need to download, but manually searching and downloading each one from the Drive UI is painful and slow. You need a CLI tool that takes your list, finds the matching files in the folder, and downloads them all to a local directory.

---

## 2. Research Findings

### 2.1 Runtime: Why Bun over Node.js

| Factor                | Bun                   | Node.js                  |
| --------------------- | --------------------- | ------------------------ |
| Startup time          | ~5-10ms               | ~50-120ms                |
| Native TypeScript     | Yes, zero config      | Requires tsx/ts-node/tsc |
| Package install       | 3-25x faster          | Baseline                 |
| Single binary compile | `bun build --compile` | Needs pkg/nexe           |
| Test runner           | Built-in `bun:test`   | Needs Jest/Vitest        |
| Bundler               | Built-in `bun build`  | Needs tsup/esbuild       |
| Node.js compat        | ~95%+ in 2026         | N/A                      |

**Verdict:** Bun is ideal for CLI tools. The `googleapis` npm package is pure JavaScript (no native bindings), so it runs on Bun without issues. Bun's fast startup makes the CLI feel instant, and `bun build --compile` lets us distribute a single binary with zero runtime dependencies.

### 2.2 Authentication: Can We Skip Google Cloud Console?

**Short answer: No.** Google Drive API _always_ requires OAuth2 or a Service Account, both of which need a Google Cloud Console project. There is no "just login with Google" API for third-party apps without registering.

**Decision: OAuth2 Desktop App with config file + env var override + Auto-Reauth**

The credentials are stored in `~/.config/gdrive-dl/config.json`, with environment variable override support. Users run `gdrive-dl auth --setup` once to configure, then authenticate via browser. The credentials are safe to embed because they're "installed app" type (not web server) — the security comes from the user's browser-based consent, not from keeping the client secret hidden.

**Auto-Reauth Behavior:** On every CLI run, if a token exists, check validity first. If expired or invalid, automatically trigger re-authentication via browser before proceeding with the command.

**One-time setup (5 minutes):**

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create project → Enable Google Drive API
3. OAuth consent screen → External → Test mode → Add your email as test user
4. Create credentials → OAuth 2.0 Client ID → Desktop App
5. Run `gdrive-dl auth --setup` and enter your `client_id` and `client_secret`

**Configuration file (`~/.config/gdrive-dl/config.json`):**

```jsonc
{
  "oauth": {
    "clientId": "your-client-id.apps.googleusercontent.com",
    "clientSecret": "your-client-secret",
    "scopes": ["https://www.googleapis.com/auth/drive.readonly"],
    "redirectUri": "http://localhost",
  },
  "download": {
    "concurrency": 3,
    "retries": 2,
  },
}
```

**Environment variable override (takes precedence):**

- `GDRIVEDL_OAUTH_CLIENT_ID`
- `GDRIVEDL_OAUTH_CLIENT_SECRET`

### 2.3 Tech Stack (Final)

| Layer               | Choice                | Why                                                   |
| ------------------- | --------------------- | ----------------------------------------------------- |
| **Runtime**         | Bun 1.3+              | Fast startup, native TS, single-binary compile        |
| **CLI framework**   | Commander.js 12+      | Most popular, battle-tested, clean API                |
| **Google Drive**    | googleapis 144+       | Official SDK, pure JS, works on Bun                   |
| **Auth**            | google-auth-library   | Lighter than `@google-cloud/local-auth`, more control |
| **Terminal colors** | chalk 5+              | ESM, lightweight                                      |
| **Spinner**         | ora 8+                | Elegant loading indicators                            |
| **Progress bar**    | cli-progress 3+       | Download progress (TTY-aware, falls back to lines)    |
| **Prompts**         | @inquirer/prompts 7+  | Modern, ESM-first, tree-shakeable                     |
| **Config storage**  | conf 13+              | Stores token in `~/.config/gdrive-dl/`                |
| **Build**           | `bun build --compile` | Single executable, no runtime needed                  |
| **Testing**         | `bun:test`            | Built-in, Jest-compatible API                         |
| **Linting**         | Biome                 | Fast, replaces ESLint + Prettier                      |

---

## 3. Architecture

### 3.1 Project Structure

```
gdrive-dl/
├── src/
│   ├── cli.ts              # Entry point, Commander setup
│   ├── commands/
│   │   ├── auth.ts          # `gdrive-dl auth` — login flow
│   │   ├── download.ts      # `gdrive-dl download` — main command
│   │   ├── list.ts          # `gdrive-dl list` — list folder files
│   │   └── logout.ts        # `gdrive-dl logout` — clear token
│   ├── lib/
│   │   ├── auth.ts          # OAuth2 client, token management, auto-reauth
│   │   ├── drive.ts         # Drive API operations (list, download, resume)
│   │   ├── matcher.ts       # Filename matching logic, NFC normalization
│   │   ├── reporter.ts      # JSON report generation and file writing
│   │   ├── sanitizer.ts     # Path sanitization for hierarchy preservation
│   │   ├── config.ts        # Config/token storage paths
│   │   ├── settings.ts      # Config file loading with env var override
│   │   └── logger.ts        # Chalk-based logging, TTY-aware output
│   └── constants.ts         # App version, token/report directory names
├── tests/
│   ├── matcher.test.ts      # Unit tests for filename matching
│   ├── drive.test.ts        # Integration tests (mocked API)
│   └── cli.test.ts          # E2E command tests
├── package.json
├── tsconfig.json
├── biome.json
├── README.md
└── SPEC.md                  # This file
```

### 3.2 Data Flow

```
┌──────────────────────────────────────────────────────────────┐
│                        CLI Input                             │
│  gdrive-dl download -u <folder_url> -f names.txt -o ./       │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────┐
│   0. Auth Check (FIRST)  │
│   - Load saved token     │
│   - Check if valid       │
│   - If expired → re-auth │
│   - If missing → auth    │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│   1. Parse Input         │
│   - Extract folder ID    │
│   - Read filenames.txt   │
│   - NFC normalize names  │
│   - Deduplicate names    │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│   2. List Folder Files   │
│   - Recursive (if set)  │
│   - Paginate all files   │
│   - Cache file metadata  │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│   3. Match Filenames     │
│   - NFC normalize        │
│   - Case-insensitive     │
│   - Extension-agnostic   │
│   - Fuzzy suggestions    │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│   4. Confirm & Download  │
│   - Sanitize paths       │
│   - Concurrent downloads │
│   - Resume support       │
│   - Progress bars        │
│   - Checksum verify      │
│   - Retry w/ jitter      │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│   5. Write Report        │
│   - JSON summary file    │
│   - Partial on abort     │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│   6. Summary & Exit      │
│   - Console summary      │
│   - Exit code            │
└──────────────────────────┘
```

---

## 4. Detailed Specifications

### 4.1 Command: `gdrive-dl auth`

**Purpose:** Authenticate with Google Drive via browser-based OAuth2.

**Options:**

- `-f, --force` — Re-authenticate even if a valid token exists
- `-s, --setup` — Interactive first-time setup (configure OAuth credentials)

**Behavior:**

1. Check if token already exists at `~/.config/gdrive-dl/token.json`
2. If valid token exists, print "Already authenticated as <email>" and exit
3. If no token or expired: start local HTTP server on random port, open browser to Google consent screen
4. User logs in and grants read-only access
5. Exchange auth code for access + refresh tokens
6. Save tokens to `~/.config/gdrive-dl/token.json`
7. Print success message

**Token storage:**

```jsonc
// ~/.config/gdrive-dl/token.json
{
  "access_token": "ya29...",
  "refresh_token": "1//...",
  "token_type": "Bearer",
  "expiry_date": 1714000000000,
  "email": "user@gmail.com",
}
```

**Edge cases:**

- Token refresh happens automatically on API calls
- If refresh fails (revoked access), trigger re-auth automatically
- Support `--force` flag to re-authenticate even with valid token

---

### 4.2 Command: `gdrive-dl download`

**Purpose:** Download files matching a name list from a Drive folder.

**Signature:**

```
gdrive-dl download [options]

Options:
  -u, --url <url>          Google Drive folder URL or folder ID (required)
  -f, --file <path>        Text file with filenames, one per line
  -n, --names <names...>   Inline filenames (space-separated)
  -o, --output <dir>       Output directory (default: ./downloads)
  -c, --concurrency <n>    Parallel downloads (default: 3, max: 8)
  -r, --retries <n>        Retry failed downloads (default: 2)
  -y, --yes                Skip confirmation prompt
  --recursive              Search subfolders recursively
  --fuzzy                  Show fuzzy match suggestions for unmatched names
  --overwrite              Overwrite existing files instead of skipping
  --resume                 Resume interrupted downloads (byte-range)
  --checksum               Verify downloaded files with MD5
  --dry-run                Show what would be downloaded without downloading
  --report                 Write JSON report to file (default: true for download)
  --report-path <file>     Override default report path
```

**Input parsing:**

- `--url` accepts any of:
  - `https://drive.google.com/drive/folders/FOLDER_ID`
  - `https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing`
  - `https://drive.google.com/drive/u/0/folders/FOLDER_ID`
  - Raw folder ID string
- `--file` reads a text file, one filename per line:
  - Lines starting with `#` are comments (ignored)
  - Empty lines are ignored
  - Leading/trailing whitespace is trimmed
  - Filenames are WITHOUT extension
- `--names` and `--file` can be combined (union of both)
- Duplicate names are deduplicated

**Filename matching algorithm:**

```typescript
function matchFiles(allFiles: DriveFile[], searchNames: string[]): MatchResult {
  for (const name of searchNames) {
    const normalized = normalizeToNfc(name);

    // 1. Exact match (NFC-normalized, case-insensitive, without extension)
    const exact = allFiles.filter(
      (f) =>
        normalizeToNfc(removeExtension(f.name)).toLowerCase() ===
        normalized.toLowerCase(),
    );

    if (exact.length > 0) {
      matched.push(...exact);
      continue;
    }

    // 2. If --fuzzy enabled, find close matches
    if (fuzzyEnabled) {
      const suggestions = allFiles
        .map((f) => ({
          file: f,
          distance: levenshtein(
            normalized.toLowerCase(),
            normalizeToNfc(removeExtension(f.name)).toLowerCase(),
          ),
        }))
        .filter((s) => s.distance <= 3)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3);

      if (suggestions.length > 0) {
        fuzzyMatches.push({ name, candidates: suggestions });
      }
    }

    unmatched.push(name);
  }
}
```

**Filename normalization:**

- All input names (from `--file` and `--names`) are normalized to NFC before matching.
- All Drive file names are normalized to NFC before matching.
- Original names are preserved for download output filenames.

**Recursive search with hierarchy preservation:**

When `--recursive` is enabled:

1. List all files in folder and subfolders recursively via Drive API
2. Store each file's full path relative to the root folder
3. Sanitize every path segment before use (see Path Sanitization)
4. When downloading, preserve the folder structure in output:
   ```
   Drive: MyFolder/subfolder1/photo.jpg
   → Output: ./downloads/MyFolder/subfolder1/photo.jpg
   ```
5. If the same filename exists in multiple subfolders, download each to its respective path (no collision — fully-qualified paths used in `items[]`)

**Download behavior:**

- Downloads run concurrently (configurable, default 3, capped at 8)
- Progress bars disable automatically on non-TTY (CI environments) — falls back to line-by-line output
- On failure, retry up to N times with exponential backoff + jitter
- If file already exists in output dir:
  - Default: Skip with warning
  - `--overwrite`: Replace existing file
  - `--resume`: Check partial file, resume from last byte if possible
- Google Workspace files (Docs, Sheets) are exported: Docs → PDF, Sheets → XLSX
  - **Resume not supported** for exports (byte-range may not work for export API)
  - **Checksum**: For binary files, MD5 is available from Drive API and used for verification. For exported Google Workspace files, MD5 is not provided by the export API — checksum verification is skipped and `verified: false, reason: "export_no_md5"` is reported.

**Resume behavior (--resume):**

- Before downloading, check if partial file exists in output
- If exists, query Drive for file size and local file size
- If local is partial and file is a binary (not exported), resume from local size position (byte-range request)
- If Drive file changed (size differs), restart from scratch
- For Google Workspace exports: always restart from scratch (no byte-range), log `resumed: false`
- After 3 failed resume attempts, delete partial file and retry from beginning
- On any retry failure: delete partial file, leave clean state

**Checksum verification (--checksum):**

- **Binary files**: Use MD5 hash provided by Drive API. After download, compute local MD5 and compare. If mismatch: delete corrupted file, retry.
- **Exported Google Workspace files**: MD5 is not available from export API. Report `checksum.verified = false` and `checksum.reason = "export_no_md5"`. Do not fail the download.
- Report verification status per-file and summary counts.

**Retry with exponential backoff + jitter:**

- Base delays: 1s, 2s, 4s (per retry attempt)
- Jitter: multiply by `(1 + random(0, 0.2))` to avoid thundering herd on shared folders
- Rate limit (429): use same backoff before retrying

**Path sanitization:**

Every path segment (for hierarchy preservation) is sanitized before use:

```typescript
function sanitizePathSegment(segment: string): string {
  return segment
    .replace(/\.\./g, "") // strip parent-directory traversal
    .replace(/[/\\:*?"<>|]/g, "_") // replace illegal OS characters
    .replace(/^\.+/, "") // strip leading dots (hidden files)
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

function sanitizeOutputPath(relativePath: string): string {
  return relativePath
    .split(/[/\\]/) // split on any separator
    .map(sanitizePathSegment)
    .filter(Boolean)
    .join("/"); // normalize to forward slashes
}
```

- Empty segments (from `//` or stripped names) are removed
- Resulting empty paths fall back to the filename alone

**Exit codes:**

| Code | Meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| 0    | All matched downloads succeeded                                       |
| 2    | Some downloads failed (one or more non-fatal errors)                  |
| 3    | No files matched (nothing to download)                                |
| 1    | Fatal error (auth failure, invalid URL, no access, permission denied) |

---

### 4.3 Command: `gdrive-dl list`

**Purpose:** List all files in a Drive folder, with optional search/filter.

**Signature:**

```
gdrive-dl list [options]

Options:
  -u, --url <url>          Google Drive folder URL or folder ID (required)
  -s, --search <term>      Filter files by name (case-insensitive contains)
  --type <ext>             Filter by extension (e.g., jpg, png, pdf)
  --recursive              List files in subfolders recursively
  --json                   Output as JSON (for piping to other tools)
  --count                  Only show file count
```

**Output formats:**

Default:

```
$ gdrive-dl list -u "..." -s "sunset" --recursive

Found 248 files (in 12 subfolders), showing 3 matching "sunset":

  sunset_beach.jpg          2.4 MB    2024-03-15    MyFolder/vacation/
  sunset_mountain.png        1.8 MB    2024-03-10    MyFolder/landscapes/
  sunset_final_v2.psd      45.2 MB    2024-03-20    MyFolder/design/
```

JSON (for scripting):

```json
[
  {
    "id": "abc123",
    "name": "sunset_beach.jpg",
    "size": 2516582,
    "mimeType": "image/jpeg",
    "modifiedTime": "2024-03-15T10:30:00Z",
    "path": "MyFolder/vacation/"
  }
]
```

---

### 4.4 Command: `gdrive-dl logout`

**Purpose:** Clear saved authentication token.

**Behavior:**

1. Delete `~/.config/gdrive-dl/token.json`
2. Optionally revoke token with Google (if `--revoke` flag)
3. Print confirmation

---

### 4.5 Logging & Report

**Purpose:** Persist a machine-readable JSON summary of every download run.

**Flags:**

- `--report` — Enable report writing (default: `true` for `download`, `false` for `list`)
- `--report-path <file>` — Override default report path

**Default path:**

- `~/.config/gdrive-dl/reports/YYYYMMDD-HHMMSS.json`
- Directory (`~/.config/gdrive-dl/reports/`) is auto-created if it does not exist
- One file per run (no append)

**Report file overwrite:**

- If `--report-path` points to an existing file and `--overwrite` is not set, the CLI exits with error before starting downloads.
- If `--overwrite` is set, the existing file is replaced.

**Report write timing:**

- Report is written at the end of a successful or partially-successful run.
- If the process is interrupted (SIGINT, SIGTERM, crash), a partial report is written with `status: "aborted"` and whatever items were processed at that point.

**JSON Report Structure:**

```typescript
interface DownloadReport {
  status: "success" | "partial" | "aborted";
  metadata: {
    tool: "gdrive-dl";
    version: string;
    runtime: "bun";
    command: "download";
    startTime: string; // ISO 8601
    endTime: string; // ISO 8601
    durationMs: number;
    userEmail: string | null;
    args: {
      url: string; // sanitized (no query params beyond ID)
      outputDir: string;
      recursive: boolean;
      concurrency: number;
      retries: number;
      overwrite: boolean;
      resume: boolean;
      checksum: boolean;
      fuzzy: boolean;
      dryRun: boolean;
      fileSource?: string; // path to --file, not the file contents
      namesCount?: number; // count of --names args
    };
  };
  summary: {
    matched: number;
    downloaded: number; // succeeded + verified
    verified: number; // passed checksum
    failed: number;
    skipped: number; // already existed, not overwritten
    notFound: number;
  };
  items: Array<{
    id: string;
    name: string; // original Drive filename
    mimeType: string;
    size: number; // bytes
    outputPath: string; // fully-qualified relative output path
    matchedBy: "exact" | "fuzzy";
    status: "success" | "failed" | "skipped";
    bytesTransferred: number;
    resumed: boolean;
    retryCount: number;
    checksum: {
      enabled: boolean;
      algorithm: "md5";
      verified: boolean;
      md5Remote?: string; // only if Drive provides it
      md5Local?: string; // only if computed
      reason?: string; // e.g., "export_no_md5", "unsupported_mime_type"
    };
    error?: {
      message: string; // sanitized, no stack traces
      code?: string;
    };
  }>;
  unmatched: string[]; // requested names with no match
  fuzzySuggestions?: Array<{
    name: string;
    candidates: Array<{
      name: string;
      path: string;
      distance: number;
    }>;
  }>;
}
```

**Security & Privacy:**

- Tokens, refresh tokens, request headers, and sensitive URL query parameters are never included.
- Error messages in `items[].error` are sanitized — no stack traces, no internal paths.
- OAuth client secrets embedded in source are never written to reports.
- URLs in `args` have query parameters stripped beyond the folder ID.

**Failure handling:**

- If writing the report fails (e.g., permission denied), print a warning to console but do not fail the CLI if downloads succeeded.
- The console summary is always shown regardless of report write status.

**Performance:**

- Report is written once at the end — no streaming/append during download.
- `items[]` arrays are kept lean; large error objects are truncated.
- For runs with thousands of files, report writing should complete in < 1 second.

---

## 5. Implementation Plan

### Phase 1: Core Foundation (Day 1)

| Task                   | File                                          | Tests                 |
| ---------------------- | --------------------------------------------- | --------------------- |
| Project scaffold       | `package.json`, `tsconfig.json`, `biome.json` | —                     |
| Constants & config     | `src/constants.ts`, `src/lib/config.ts`       | —                     |
| Logger utility         | `src/lib/logger.ts`                           | —                     |
| Sanitizer utility      | `src/lib/sanitizer.ts`                        | Unit                  |
| OAuth2 auth module     | `src/lib/auth.ts`                             | Manual (browser flow) |
| Auto-reauth on startup | `src/lib/auth.ts`                             | Manual                |
| `auth` command         | `src/commands/auth.ts`                        | Manual                |
| `logout` command       | `src/commands/logout.ts`                      | Unit                  |

**Deliverable:** `gdrive-dl auth` works — opens browser, saves token. CLI checks auth before every command.

### Phase 2: Drive Operations (Day 2)

| Task                                     | File                   | Tests                 |
| ---------------------------------------- | ---------------------- | --------------------- |
| Folder ID extraction                     | `src/lib/drive.ts`     | `tests/drive.test.ts` |
| List folder files (paginated, recursive) | `src/lib/drive.ts`     | Integration (mocked)  |
| Download single file (stream)            | `src/lib/drive.ts`     | Integration (mocked)  |
| Resume download (byte-range)             | `src/lib/drive.ts`     | Unit                  |
| Export Google Workspace files            | `src/lib/drive.ts`     | Integration (mocked)  |
| `list` command                           | `src/commands/list.ts` | E2E                   |

**Deliverable:** `gdrive-dl list -u <url> --recursive` shows all files in a folder and subfolders.

### Phase 3: Matching & Download (Day 3)

| Task                              | File                       | Tests                   |
| --------------------------------- | -------------------------- | ----------------------- |
| Filename matcher (exact)          | `src/lib/matcher.ts`       | `tests/matcher.test.ts` |
| NFC normalization in matcher      | `src/lib/matcher.ts`       | Unit                    |
| Fuzzy matching (Levenshtein)      | `src/lib/matcher.ts`       | `tests/matcher.test.ts` |
| Hierarchy preservation + sanitize | `src/lib/drive.ts`         | Unit                    |
| Input file parser                 | `src/commands/download.ts` | Unit                    |
| Concurrent download orchestrator  | `src/commands/download.ts` | Integration             |
| Progress bar (TTY-aware)          | `src/commands/download.ts` | Manual                  |
| `--overwrite` handling            | `src/commands/download.ts` | Unit                    |
| `--resume` handling               | `src/commands/download.ts` | Integration             |
| `--checksum` verification         | `src/lib/drive.ts`         | Unit                    |
| Exponential backoff + jitter      | `src/lib/drive.ts`         | Unit                    |
| `download` command (full)         | `src/commands/download.ts` | E2E                     |

**Deliverable:** `gdrive-dl download -u <url> -f names.txt --recursive` works end-to-end with hierarchy.

### Phase 4: Reporting & Polish (Day 4)

| Task                          | File                       | Tests  |
| ----------------------------- | -------------------------- | ------ |
| JSON reporter (`reporter.ts`) | `src/lib/reporter.ts`      | Unit   |
| Report write on completion    | `src/commands/download.ts` | Unit   |
| Partial report on abort       | `src/commands/download.ts` | Unit   |
| Skip existing files (default) | `src/commands/download.ts` | Unit   |
| Partial file cleanup          | `src/commands/download.ts` | Unit   |
| `--dry-run` mode              | `src/commands/download.ts` | Unit   |
| Exit codes                    | `src/commands/download.ts` | Unit   |
| `--report` / `--report-path`  | `src/commands/download.ts` | Unit   |
| Error handling & messages     | All commands               | Manual |
| Single binary build           | `package.json` scripts     | —      |
| README with GIFs              | `README.md`                | —      |

**Deliverable:** Production-ready CLI v1.2.0, distributable as single binary.

---

## 6. Key Implementation Details

### 6.1 Embedded OAuth Credentials

```typescript
// src/constants.ts
export const OAUTH = {
  clientId: "YOUR_CLIENT_ID.apps.googleusercontent.com",
  clientSecret: "GOCSPX-YOUR_SECRET",
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  redirectUri: "http://localhost",
} as const;

export const CONFIG_DIR = "gdrive-dl";
export const TOKEN_FILE = "token.json";
export const REPORTS_DIR = "reports";
```

### 6.2 Auth Flow with Auto-Reauth

```typescript
// src/lib/auth.ts
export async function authenticate(): Promise<OAuth2Client> {
  const client = createOAuth2Client();
  const saved = loadToken();

  if (saved) {
    client.setCredentials(saved);
    if (isExpired(saved)) {
      try {
        const { credentials } = await client.refreshAccessToken();
        saveToken(credentials);
        client.setCredentials(credentials);
      } catch {
        console.log("Session expired. Re-authenticating...");
        return await startInteractiveAuth(client);
      }
    }
    return client;
  }

  return await startInteractiveAuth(client);
}
```

### 6.3 Path Sanitization

```typescript
// src/lib/sanitizer.ts
export function sanitizePathSegment(segment: string): string {
  return segment
    .replace(/\.\./g, "")
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeOutputPath(relativePath: string): string {
  if (!relativePath) return "";
  return relativePath
    .split(/[/\\]/)
    .map(sanitizePathSegment)
    .filter(Boolean)
    .join("/");
}
```

### 6.4 Filename Normalization (NFC)

```typescript
// src/lib/matcher.ts
export function normalizeToNfc(str: string): string {
  return str.normalize("NFC");
}
```

Note: `String.prototype.normalize("NFC")` is a built-in JavaScript API available in Bun and Node.js — no external library needed.

### 6.5 Exponential Backoff with Jitter

```typescript
// src/lib/drive.ts
function getBackoffWithJitter(attempt: number, baseMs = 1000): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = exponential * (1 + Math.random() * 0.2);
  return Math.floor(jitter);
}

async function downloadWithRetry(
  file: DriveFile,
  outputPath: string,
  options: { retries: number; onProgress: ProgressCallback },
): Promise<DownloadResult> {
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await downloadFile(file, outputPath, options);
    } catch (err) {
      if (isRateLimited(err)) {
        const delay = getBackoffWithJitter(attempt);
        console.log(`Rate limited. Waiting ${delay}ms...`);
        await Bun.sleep(delay);
        continue;
      }
      if (attempt < options.retries) {
        const delay = getBackoffWithJitter(attempt);
        await Bun.sleep(delay);
        continue;
      }
      return { file, error: sanitizeError(err), status: "failed" };
    }
  }
}
```

### 6.6 Resume Download with Byte-Range

```typescript
// src/lib/drive.ts
export async function downloadWithResume(
  file: DriveFile,
  outputPath: string,
  options: DownloadOptions,
): Promise<DownloadResult> {
  const stats = (await fileExists(outputPath)) ? await stat(outputPath) : null;
  const isExport = isGoogleWorkspaceFile(file.mimeType);

  const headers: Record<string, string> = {};
  let startByte = 0;

  // Resume only for binary files, not exports
  if (stats && stats.size > 0 && !isExport) {
    startByte = stats.size;
    headers["Range"] = `bytes=${startByte}-`;
  } else if (stats && stats.size > 0 && isExport) {
    // Export file: cannot resume, restart from scratch
    await Bun.write(outputPath, "");
    startByte = 0;
  }

  try {
    const response = await downloadFile(file, outputPath, {
      ...options,
      headers,
      startByte,
    });

    if (options.checksum && !isExport) {
      const verified = await verifyMd5(outputPath, file.md5Hash);
      if (!verified) {
        await Bun.write(outputPath, "");
        throw new Error("Checksum mismatch");
      }
    } else if (options.checksum && isExport) {
      response.checksum = {
        enabled: true,
        algorithm: "md5",
        verified: false,
        reason: "export_no_md5",
      };
    }

    return response;
  } catch (err) {
    await Bun.write(outputPath, "");
    throw err;
  }
}
```

### 6.6b Google Workspace Exports

Google Workspace files (Docs, Sheets) use a **different API** from binary files:

```typescript
// src/lib/drive.ts

// Binary files: use files.get with alt=media
// Two-argument form: ({ fileId, alt }, { responseType })
const binaryResponse = await drive.files.get(
  { fileId: file.id, alt: "media" },
  { responseType: "stream" },
);

// Google Workspace exports: use files.export (different endpoint)
// Docs → PDF, Sheets → XLSX (or user-specified mimeType)
const EXPORT_MIME_TYPES: Record<string, string> = {
  "application/vnd.google-apps.document": "application/pdf",
  "application/vnd.google-apps.spreadsheet":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.xlsx",
  "application/vnd.google-apps.presentation": "application/pdf",
};

async function exportWorkspaceFile(
  auth: OAuth2Client,
  file: DriveFile,
  outputPath: string,
): Promise<DownloadResult> {
  const exportMime = EXPORT_MIME_TYPES[file.mimeType];
  if (!exportMime) {
    return {
      file,
      error: `Unsupported export type: ${file.mimeType}`,
      status: "failed",
    };
  }

  const response = await drive.files.export(
    { fileId: file.id, mimeType: exportMime },
    { responseType: "stream" },
  );

  const fileHandle = await Bun.open(outputPath, "w");
  await response.data.pipe(fileHandle);
  await fileHandle.close();

  return { file, path: outputPath, status: "success" };
}
```

**Key differences:**

| Aspect            | Binary download (`files.get` + `alt:media`) | Workspace export (`files.export`) |
| ----------------- | ------------------------------------------- | --------------------------------- |
| API method        | `files.get` with `alt=media`                | `files.export`                    |
| MD5 available     | Yes (Drive computes it)                     | No (exported content differs)     |
| Byte-range resume | Supported                                   | Not supported                     |
| Response headers  | `content-length`, `content-range`           | `content-length` only             |

### 6.7 Resume Download with Byte-Range

```typescript
// src/lib/drive.ts
export async function downloadWithResume(
  file: DriveFile,
  outputPath: string,
  options: DownloadOptions,
): Promise<DownloadResult> {
  const stats = (await fileExists(outputPath)) ? await stat(outputPath) : null;
  const isExport = isGoogleWorkspaceFile(file.mimeType);

  const headers: Record<string, string> = {};
  let startByte = 0;

  // Resume only for binary files, not exports
  if (stats && stats.size > 0 && !isExport) {
    startByte = stats.size;
    headers["Range"] = `bytes=${startByte}-`;
  } else if (stats && stats.size > 0 && isExport) {
    // Export file: cannot resume, restart from scratch
    await Bun.write(outputPath, "");
    startByte = 0;
  }

  try {
    const response = await downloadFile(file, outputPath, {
      ...options,
      headers,
      startByte,
    });

    if (options.checksum && !isExport) {
      const verified = await verifyMd5(outputPath, file.md5Hash);
      if (!verified) {
        await Bun.write(outputPath, "");
        throw new Error("Checksum mismatch");
      }
    } else if (options.checksum && isExport) {
      response.checksum = {
        enabled: true,
        algorithm: "md5",
        verified: false,
        reason: "export_no_md5",
      };
    }

    return response;
  } catch (err) {
    await Bun.write(outputPath, "");
    throw err;
  }
}
```

### 6.8 TTY-Aware Console Output

```typescript
// src/lib/logger.ts
export const IS_TTY = Bun.stdout.isTTY;

export function renderProgress(file: FileProgress): void {
  if (IS_TTY) {
    progressBar.update(file.percent, { filename: file.name });
  } else {
    const percent = file.percent.toFixed(0).padStart(3);
    const size = formatBytes(file.size).padStart(8);
    console.log(`[${percent}%] ${file.name} (${size})`);
  }
}
```

### 6.9 JSON Reporter

```typescript
// src/lib/reporter.ts
import { REPORTS_DIR } from "../constants.ts";
import { getConfigDir } from "./config.ts";

export async function writeReport(
  report: DownloadReport,
  reportPath?: string,
): Promise<void> {
  const dir = join(getConfigDir(), REPORTS_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const defaultPath = join(dir, `${timestamp}.json`);

  await mkdir(dir, { recursive: true });

  const finalPath = reportPath || defaultPath;
  const content = JSON.stringify(report, null, 2);

  try {
    await Bun.write(finalPath, content);
  } catch (err) {
    console.warn(`⚠ Could not write report to ${finalPath}: ${err.message}`);
  }
}

export async function writeAbortReport(
  partial: Partial<DownloadReport>,
  reportPath?: string,
): Promise<void> {
  const report: DownloadReport = {
    ...buildBaseReport(partial),
    status: "aborted",
  };
  await writeReport(report, reportPath);
}
```

---

## 7. Build & Distribution

### 7.1 Development

```bash
bun install
bun run src/cli.ts auth
bun run src/cli.ts download -u "..." -f names.txt
bun test
bunx biome check --fix .
```

### 7.2 Build Single Executable

```jsonc
{
  "scripts": {
    "dev": "bun run src/cli.ts",
    "build": "bun build src/cli.ts --compile --outfile dist/gdrive-dl",
    "build:linux": "bun build src/cli.ts --compile --target=bun-linux-x64 --outfile dist/gdrive-dl-linux",
    "build:mac": "bun build src/cli.ts --compile --target=bun-darwin-arm64 --outfile dist/gdrive-dl-mac",
    "build:win": "bun build src/cli.ts --compile --target=bun-windows-x64 --outfile dist/gdrive-dl.exe",
    "test": "bun test",
    "lint": "bunx biome check .",
  },
}
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

```typescript
// tests/matcher.test.ts
import { describe, test, expect } from "bun:test";
import {
  matchFiles,
  removeExtension,
  normalizeToNfc,
} from "../src/lib/matcher";

describe("removeExtension", () => {
  test("removes single extension", () =>
    expect(removeExtension("photo.jpg")).toBe("photo"));
  test("handles no extension", () =>
    expect(removeExtension("photo")).toBe("photo"));
  test("handles multiple dots", () =>
    expect(removeExtension("my.photo.final.jpg")).toBe("my.photo.final"));
});

describe("normalizeToNfc", () => {
  test("normalizes unicode to NFC form", () => {
    const composed = "café";
    const decomposed = "cafe\u0301";
    expect(normalizeToNfc(decomposed)).toBe(composed);
  });
});

describe("matchFiles", () => {
  const files = [
    {
      id: "1",
      name: "sunset_beach.jpg",
      mimeType: "image/jpeg",
      path: "vacation/",
    },
    {
      id: "2",
      name: "sunset_beach.png",
      mimeType: "image/png",
      path: "vacation/",
    },
    { id: "3", name: "Photo_001.JPG", mimeType: "image/jpeg", path: "photos/" },
    {
      id: "4",
      name: "café_document.pdf",
      mimeType: "application/pdf",
      path: "docs/",
    },
  ];

  test("matches NFC-normalized input to NFD-stored file", () => {
    const result = matchFiles(files, ["cafe\u0301_document"]);
    expect(result.matched).toHaveLength(1);
  });

  test("matches all extensions for same base name", () => {
    const result = matchFiles(files, ["sunset_beach"]);
    expect(result.matched).toHaveLength(2);
  });

  test("reports unmatched names", () => {
    const result = matchFiles(files, ["nonexistent"]);
    expect(result.unmatched).toEqual(["nonexistent"]);
  });

  test("includes fully-qualified paths in items", () => {
    const result = matchFiles(files, ["sunset_beach"]);
    expect(result.matched[0].path).toBe("vacation/");
  });
});
```

```typescript
// tests/sanitizer.test.ts
import { describe, test, expect } from "bun:test";
import { sanitizePathSegment, sanitizeOutputPath } from "../src/lib/sanitizer";

describe("sanitizePathSegment", () => {
  test("strips parent-directory traversal", () => {
    expect(sanitizePathSegment("../etc/passwd")).toBe("etcpasswd");
    expect(sanitizePathSegment("foo/../bar")).toBe("foobar");
  });
  test("replaces illegal OS characters", () => {
    expect(sanitizePathSegment("file*name?.txt")).toBe("file_name__.txt");
  });
  test("strips leading dots", () => {
    expect(sanitizePathSegment("...hidden")).toBe("hidden");
  });
});

describe("sanitizeOutputPath", () => {
  test("normalizes mixed separators and sanitizes", () => {
    expect(sanitizeOutputPath("foo\\bar//baz/..qux")).toBe("foo/bar/qux");
  });
  test("handles empty segments", () => {
    expect(sanitizeOutputPath("foo//bar")).toBe("foo/bar");
  });
});
```

```typescript
// tests/backoff.test.ts
import { describe, test, expect } from "bun:test";
import { getBackoffWithJitter } from "../src/lib/drive";

describe("getBackoffWithJitter", () => {
  test("base delay doubles each attempt", () => {
    const d0 = getBackoffWithJitter(0, 1000);
    const d1 = getBackoffWithJitter(1, 1000);
    expect(d1).toBeGreaterThan(d0);
  });

  test("jitter is within expected range", () => {
    for (let i = 0; i < 100; i++) {
      const d = getBackoffWithJitter(0, 1000);
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(1200);
    }
  });
});
```

### 8.2 Integration Tests (Mocked Drive API)

```typescript
// tests/drive.test.ts
import { describe, test, expect, mock } from "bun:test";
import { extractFolderId, listFilesRecursive } from "../src/lib/drive";

describe("extractFolderId", () => {
  test("extracts from full URL", () => {
    expect(
      extractFolderId(
        "https://drive.google.com/drive/folders/1abc123def?usp=sharing",
      ),
    ).toBe("1abc123def");
  });
  test("extracts from /u/0/ URL", () => {
    expect(
      extractFolderId("https://drive.google.com/drive/u/0/folders/1abc123def"),
    ).toBe("1abc123def");
  });
  test("returns raw ID as-is", () => {
    expect(extractFolderId("1abc123def")).toBe("1abc123def");
  });
  test("throws on invalid input", () => {
    expect(() => extractFolderId("not a url or id!")).toThrow();
  });
});
```

### 8.3 E2E Tests

```typescript
// tests/cli.test.ts
import { describe, test, expect } from "bun:test";

describe("CLI", () => {
  test("--help shows usage", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "--help"]);
    const output = await new Response(proc.stdout).text();
    expect(output).toContain("gdrive-dl");
    expect(output).toContain("download");
    expect(output).toContain("list");
  });

  test("download requires --url", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "download"]);
    expect(proc.exitCode).not.toBe(0);
  });

  test("--recursive is accepted", async () => {
    const proc = Bun.spawn([
      "bun",
      "run",
      "src/cli.ts",
      "download",
      "-u",
      "fake",
      "-f",
      "names.txt",
      "--recursive",
    ]);
    expect(proc.exitCode).not.toBe(0); // fails at execution, not parsing
  });

  test("--report and --report-path are accepted", async () => {
    const proc = Bun.spawn([
      "bun",
      "run",
      "src/cli.ts",
      "download",
      "-u",
      "fake",
      "-f",
      "names.txt",
      "--report",
      "--report-path",
      "/tmp/test-report.json",
    ]);
    expect(proc.exitCode).not.toBe(0);
  });
});
```

---

## 9. Error Handling Matrix

| Error                       | Detection          | User Message                                              | Action                          | Exit Code |
| --------------------------- | ------------------ | --------------------------------------------------------- | ------------------------------- | --------- |
| No token                    | Token file missing | "Not authenticated. Running auth..."                      | Auto-trigger auth               | 1         |
| Token expired               | 401 from API       | (silent reauth)                                           | Auto-refresh → reauth if needed | —         |
| Token revoked               | Refresh fails      | "Session expired. Re-authenticating..."                   | Auto-trigger auth               | —         |
| Invalid folder URL          | Regex no match     | "Cannot extract folder ID from: <url>"                    | Exit                            | 1         |
| Folder not found            | 404 from API       | "Folder not found. Check the URL and your access."        | Exit                            | 1         |
| No access                   | 403 from API       | "Access denied. Make sure the folder is shared with you." | Exit                            | 1         |
| File download error         | Stream error       | "✗ filename.jpg: <error>"                                 | Retry with jitter, then skip    | 2         |
| Rate limited                | 429 from API       | "Rate limited. Waiting <N>s..."                           | Exponential backoff + jitter    | —         |
| Network error               | ECONNREFUSED etc.  | "Network error. Check your connection."                   | Retry with jitter               | 2         |
| Resume mismatch             | File size differs  | "File changed on Drive. Restarting download..."           | Restart from scratch            | —         |
| Checksum mismatch           | MD5 comparison     | "✗ filename.jpg: Checksum failed. Redownloading..."       | Delete, retry                   | 2         |
| Export checksum unavailable | Export API         | (silent, reported in JSON)                                | Skip verification               | —         |
| Output dir not writable     | EACCES             | "Cannot write to <dir>. Check permissions."               | Exit                            | 1         |
| Partial download            | On interrupt       | (file left incomplete)                                    | Clean up on retry               | —         |
| Report write failure        | File system error  | "⚠ Could not write report to <path>: <error>"             | Warn, continue                  | —         |
| Report file exists          | File exists        | "Report file exists. Use --overwrite to replace."         | Exit                            | 1         |
| No files matched            | Empty matched[]    | "No files matched. Nothing to download."                  | Exit                            | 3         |

---

## 10. Dependencies (package.json)

```jsonc
{
  "name": "gdrive-dl",
  "version": "1.2.0",
  "description": "Batch download files from Google Drive by filename",
  "type": "module",
  "bin": {
    "gdrive-dl": "./src/cli.ts",
  },
  "scripts": {
    "dev": "bun run src/cli.ts",
    "build": "bun build src/cli.ts --compile --outfile dist/gdrive-dl",
    "test": "bun test",
    "lint": "bunx biome check .",
  },
  "dependencies": {
    "chalk": "^5.4.0",
    "cli-progress": "^3.12.0",
    "commander": "^12.1.0",
    "conf": "^13.0.0",
    "google-auth-library": "^9.14.0",
    "googleapis": "^144.0.0",
    "@inquirer/prompts": "^7.0.0",
    "ora": "^8.1.0",
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@types/cli-progress": "^3.11.6",
    "@types/bun": "latest",
  },
}
```

---

## 11. Google Cloud Console Setup (One-Time, 5 Minutes)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create project → Enable Google Drive API
3. OAuth consent screen → External → Test mode → Add your email as test user
4. Create credentials → OAuth 2.0 Client ID → Desktop App
5. Copy **Client ID** and **Client Secret** → paste into `src/constants.ts`

> **Note:** In "Testing" mode, tokens expire after 7 days. With Auto-Reauth enabled, the CLI will automatically re-authenticate when needed.

---

## 12. Changelog

### v1.2.0 (Current)

**Added:**

- `--report` and `--report-path` flags for persistent JSON summary reports
- JSON report written on completion (or partial on abort)
- `src/lib/reporter.ts` for report generation
- `src/lib/sanitizer.ts` for path sanitization
- NFC normalization for filename matching (handles Unicode equivalence)
- Exponential backoff with jitter for retries and rate limiting
- Concurrency cap at 8 (was 10)
- TTY-aware progress bars (disable on non-TTY/CI)
- Exit codes: 0 (all success), 1 (fatal), 2 (partial failure), 3 (no match)
- Checksum verification explicitly skipped for exported Google Workspace files
- Resume explicitly skipped for exported Google Workspace files
- Fully-qualified relative paths included in download `items[]` for duplicate name clarity

**Changed:**

- Default concurrency remains 3; max is now 8
- Backoff uses jitter to avoid hammering shared Drive folders

**Improved:**

- Path traversal protection via sanitization
- Unicode matching via NFC normalization
- Error messages sanitized in reports (no stack traces)
- Report written once at end (no streaming overhead)

### v1.1.0

**Added:**

- `--recursive` flag for searching subfolders
- Folder hierarchy preservation in output
- `--overwrite` flag to replace existing files
- `--resume` flag for resuming interrupted downloads (byte-range)
- `--checksum` flag for MD5 verification
- Auto-reauth on token expiry (checked at start of every command)
- Partial download cleanup on failure

**Changed:**

- Token validity checked at start of every CLI command
- Default behavior for existing files: skip with warning
