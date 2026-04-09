# gdrive-dl

Batch download files from Google Drive by filename.

```
$ gdrive-dl download -u "https://drive.google.com/drive/folders/abc123" -f names.txt --recursive
✓ Authenticated as tri@gmail.com
✓ 12 file(s) matched
? Download 12 file(s) to ./downloads? (Y/n) Y

  ████████████████████ 100% | sunset_beach.jpg (2.4 MB) ✓ verified
  ████████████████████ 100% | photo_001.png (1.8 MB) ✓ verified
  ...
```

## Features

- **Filename matching** — Download by exact name (case-insensitive, extension-agnostic)
- **Fuzzy suggestions** — Suggests close matches for typos
- **Recursive search** — Search subfolders and preserve folder hierarchy
- **Resume downloads** — Byte-range resume for interrupted downloads
- **Checksum verification** — MD5 verification for downloaded files
- **JSON reports** — Per-run summary written to `~/.config/gdrive-dl/reports/`
- **Google Workspace** — Exports Docs/Sheets/Presentations to PDF/XLSX
- **Auto-reauth** — Automatically re-authenticates when token expires
- **TTY-aware** — Progress bars disable on CI/non-TTY environments

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- A Google Cloud Console project with Google Drive API enabled

### Google Cloud Setup (one-time, 5 minutes)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project
3. Enable the **Google Drive API**
4. Go to **APIs & Services → OAuth consent screen**
   - Choose "External" → Create
   - App name: `gdrive-dl`
   - Your email as support email
   - Leave scopes empty → Save
   - Add yourself as a **test user**
5. Go to **APIs & Services → Credentials**
   - Create Credentials → **OAuth client ID**
   - Application type: **Desktop app**
   - Name: `gdrive-dl`
6. Run `gdrive-dl auth --setup` and enter the **Client ID** and **Client Secret**
   - This saves the credentials to `~/.config/gdrive-dl/config.json`
   - You can also set them via environment variables: `GDRIVEDL_OAUTH_CLIENT_ID` and `GDRIVEDL_OAUTH_CLIENT_SECRET`

## Installation

### From source

```bash
git clone https://github.com/YOUR_USERNAME/gdrive-dl.git
cd gdrive-dl
bun install
```

### Link globally (for development)

```bash
bun link
gdrive-dl --version
```

### Build binary

```bash
bun run build        # current platform (dist/gdrive-dl)
bun run build:mac    # macOS ARM64
bun run build:linux  # Linux x64
bun run build:win    # Windows
```

## Usage

### Authenticate

```bash
# First-time setup (configure OAuth credentials)
gdrive-dl auth --setup

# Subsequent logins (uses saved credentials)
gdrive-dl auth
# Opens browser for Google login
# Token saved to ~/.config/gdrive-dl/token.json
```

Use `--force` to re-authenticate even with a valid token.

### Download files

```bash
# With a file containing filenames (one per line)
gdrive-dl download -u "https://drive.google.com/drive/folders/ID" -f names.txt

# With inline filenames
gdrive-dl download -u "ID" -n "photo.jpg" "doc.pdf" "image.png"

# Download recursively (preserves subfolder structure)
gdrive-dl download -u "ID" -f names.txt --recursive

# Skip confirmation, overwrite existing, verify checksums
gdrive-dl download -u "ID" -f names.txt -y --overwrite --checksum

# Resume interrupted downloads
gdrive-dl download -u "ID" -f names.txt --resume

# Fuzzy matching for typos
gdrive-dl download -u "ID" -f names.txt --fuzzy

# Dry run (show what would be downloaded)
gdrive-dl download -u "ID" -f names.txt --dry-run

# Custom output directory
gdrive-dl download -u "ID" -f names.txt -o ./my-downloads

# Control concurrency (default: 3, max: 8)
gdrive-dl download -u "ID" -f names.txt -c 5

# Custom report path
gdrive-dl download -u "ID" -f names.txt --report --report-path ./download-report.json
```

### List files in a folder

```bash
gdrive-dl list -u "https://drive.google.com/drive/folders/ID"
gdrive-dl list -u "ID" --recursive --json
```

### Logout

```bash
gdrive-dl logout
```

## Names file format

```
# Comments start with #
landscape_v2
sunset_beach
photo_001

# Supports spaces in names
my important document
```

Filenames are matched **without extension** — `photo_001` matches `photo_001.jpg`, `photo_001.png`, etc.

## Exit codes

| Code | Meaning                                       |
| ---- | --------------------------------------------- |
| 0    | All matched downloads succeeded               |
| 2    | Some downloads failed (partial success)       |
| 3    | No files matched                              |
| 1    | Fatal error (auth failure, invalid URL, etc.) |

## Report format

Reports are written to `~/.config/gdrive-dl/reports/YYYYMMDD-HHMMSS.json` by default.

```json
{
  "status": "success",
  "metadata": {
    "tool": "gdrive-dl",
    "version": "1.2.0",
    "runtime": "bun",
    "command": "download",
    "startTime": "2025-04-10T10:00:00.000Z",
    "durationMs": 12345,
    "userEmail": "user@gmail.com",
    "args": { ... }
  },
  "summary": {
    "matched": 12,
    "downloaded": 10,
    "verified": 10,
    "failed": 0,
    "skipped": 2,
    "notFound": 3
  },
  "items": [
    {
      "id": "abc123",
      "name": "sunset_beach.jpg",
      "status": "success",
      "checksum": { "enabled": true, "algorithm": "md5", "verified": true }
    }
  ],
  "unmatched": ["nonexistent", "typo_name"]
}
```

## Development

```bash
bun install
bun run dev              # run directly
bun run src/cli.ts auth   # test auth flow
bun test                 # run tests (25 tests)
bun run lint             # lint with Biome
bun run lint:fix         # auto-fix lint issues
bun run build            # compile binary
```

## License

MIT
