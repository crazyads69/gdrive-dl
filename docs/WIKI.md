# gdrive-dl Code Wiki

This document provides a comprehensive overview of the `gdrive-dl` project architecture, major modules, key functions, dependencies, and operational instructions.

---

## 1. Overall Project Architecture

`gdrive-dl` is a command-line interface (CLI) tool designed to batch download files from a Google Drive shared folder by matching filenames. 

**Core Architectural Choices:**
- **Runtime:** Built on **Bun 1.3+** for fast startup times, native TypeScript support, and the ability to compile into a single binary (`bun build --compile`).
- **CLI Framework:** Built using **Commander.js**.
- **Authentication:** Utilizes an OAuth2 Desktop App flow. Credentials and tokens are securely stored locally (`~/.config/gdrive-dl/`). Features an automatic re-authentication mechanism if tokens expire.
- **Drive Interaction:** Uses the official `googleapis` SDK to perform recursive folder traversal, paginated API fetching, and file streaming. Supports byte-range resuming for binary files and automatic PDF/XLSX export for Google Workspace files.

**Data Flow Lifecycle:**
1. **Input Parsing:** CLI arguments (URL, filenames) are parsed.
2. **Auth Verification:** Checks local tokens; prompts re-auth if expired.
3. **Folder Traversal:** Lists files in the target Google Drive folder (recursively if specified).
4. **Filename Matching:** Normalizes requested names (NFC format) and matches them against the Drive files. Supports exact (case-insensitive, extension-agnostic) and fuzzy (Levenshtein distance) matching.
5. **Execution:** Downloads matched files concurrently. Applies OS-safe path sanitization to preserve folder hierarchy. Handles retries using exponential backoff with jitter.
6. **Reporting:** Generates a detailed JSON summary report of the operation upon completion.

---

## 2. Responsibilities of Major Modules

The codebase is organized cleanly into CLI commands and reusable library modules.

### `src/` (Source Root)
- **`cli.ts`**: The main entry point. Initializes the Commander.js program and registers all subcommands.
- **`constants.ts`**: Holds hardcoded defaults, app version, and default OAuth scopes/redirect URIs.

### `src/commands/` (CLI Commands)
- **`auth.ts`**: Handles the `auth` command, including the interactive `--setup` flow for configuring OAuth credentials and the browser-based login flow.
- **`download.ts`**: The core orchestrator for the `download` command. Handles file reading, concurrency orchestration, progress bar rendering, and report triggering.
- **`list.ts`**: Handles the `list` command to print out the contents of a Drive folder.
- **`logout.ts`**: Handles the `logout` command by deleting the local token file.

### `src/lib/` (Core Logic)
- **`auth.ts`**: Manages the OAuth2 client, token lifecycle, and the local HTTP server for capturing the Google auth redirect.
- **`drive.ts`**: Wraps Google Drive API calls. Handles folder ID extraction, paginated listing, streaming downloads, byte-range resuming, and Workspace file exporting.
- **`matcher.ts`**: Contains the filename matching logic. Implements NFC normalization, extension stripping, and fuzzy matching algorithms.
- **`reporter.ts`**: Responsible for writing the machine-readable JSON execution reports to disk.
- **`sanitizer.ts`**: Ensures downloaded files use OS-safe paths and prevents directory traversal attacks when preserving folder hierarchies.
- **`config.ts` & `settings.ts`**: Manages the loading of user settings, local directory paths (`~/.config/gdrive-dl/`), and environment variable overrides.
- **`logger.ts`**: Centralized terminal output formatting, managing chalk colors, Ora spinners, and TTY-aware progress bars.

---

## 3. Descriptions of Key Classes and Functions

### Auth (`src/lib/auth.ts`)
- **`getAuthClient()`**: Retrieves the Google OAuth2 client. Automatically loads saved tokens, checks for expiration, and triggers a browser login if necessary.
- **`startInteractiveAuth()`**: Spins up a temporary local server to handle the OAuth2 callback from Google.

### Drive Operations (`src/lib/drive.ts`)
- **`extractFolderId(url: string)`**: Parses raw IDs or full Google Drive URLs (handling `/u/0/` and `?usp=sharing` formats).
- **`listFolderFiles(auth, folderId, options)`**: Recursively fetches all file metadata within a Drive folder, handling API pagination.
- **`downloadFile(auth, file, outputPath, options)`**: Streams a binary file from Drive to disk. Uses `Range` headers if resuming an interrupted download and validates MD5 checksums post-download.
- **`exportWorkspaceFile(auth, file, outputPath)`**: Uses the Drive export API to convert Google Docs/Sheets/Slides into standard formats (PDF/XLSX).

### Filename Matching (`src/lib/matcher.ts`)
- **`matchFiles(allFiles, searchNames, options)`**: Compares a list of user-provided names against Drive files. Normalizes both sides, ignores extensions, and optionally returns Levenshtein-based fuzzy suggestions for unmatched files.
- **`normalizeToNfc(str: string)`**: Uses standard JavaScript `String.prototype.normalize("NFC")` to prevent Unicode equivalence bugs (e.g., `café` vs `cafe\u0301`).

### Sanitization (`src/lib/sanitizer.ts`)
- **`sanitizeOutputPath(relativePath: string)`**: Replaces illegal OS characters (`*?<>|`), strips leading dots, and removes directory traversal patterns (`..`) to ensure safe file creation.

---

## 4. Dependency Relationships

### Core Runtime & APIs
- **`googleapis` & `google-auth-library`**: The backbone of the application, used in `drive.ts` and `auth.ts` to interface with Google's servers.
- **`commander`**: The CLI framework parsing user input in `cli.ts` and `src/commands/`.

### CLI UX & Output
- **`cli-progress`**: Renders the concurrent download progress bars.
- **`ora`**: Provides loading spinners for API calls (like fetching folder lists).
- **`chalk`**: Used extensively in `logger.ts` for colored terminal output.
- **`@inquirer/prompts` & `@inquirer/confirm`**: Powers interactive prompts (e.g., asking the user to confirm the download count).

### Configuration
- **`conf`**: Manages persistent local JSON storage for settings and OAuth tokens in the user's home directory.

### Development & Build
- **`@biomejs/biome`**: Replaces ESLint and Prettier for fast linting and formatting.
- **Bun**: Used as the package manager, test runner (`bun test`), runtime, and bundler (`bun build --compile`).

---

## 5. Instructions for Running the Project

### Prerequisites
- **Bun 1.3+** installed on your system.
- A Google Cloud Console project with the **Google Drive API enabled**.

### 1. Installation & Build
Clone the repository and install dependencies:
```bash
bun install
```
*(Optional)* Build a single executable binary:
```bash
bun run build        # Outputs to dist/gdrive-dl
bun run build:mac    # Target macOS ARM64
bun run build:linux  # Target Linux x64
bun run build:win    # Target Windows
```

### 2. Initial Setup & Authentication
Run the setup wizard to input your Google Cloud OAuth Client ID and Secret:
```bash
bun run src/cli.ts auth --setup
```
Then, authenticate via your web browser:
```bash
bun run src/cli.ts auth
```

### 3. Common Usage Examples

**Download files matching names in a text file:**
```bash
bun run src/cli.ts download -u "https://drive.google.com/drive/folders/ID" -f names.txt
```

**Recursive download with fuzzy matching and resume support:**
```bash
bun run src/cli.ts download -u "ID" -f names.txt --recursive --fuzzy --resume
```

**List all files in a folder recursively:**
```bash
bun run src/cli.ts list -u "ID" --recursive
```

### 4. Development Commands
- **Run the test suite:**
  ```bash
  bun test
  ```
- **Lint the codebase:**
  ```bash
  bun run lint
  bun run lint:fix
  ```