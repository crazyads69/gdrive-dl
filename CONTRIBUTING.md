# Contributing to gdrive-dl

First off, thank you for considering contributing to `gdrive-dl`! It's people like you that make open-source tools great.

## Code of Conduct
By participating in this project, you agree to abide by our Code of Conduct. Please be respectful and considerate of others in discussions and reviews.

## How Can I Contribute?

### Reporting Bugs
If you find a bug, please open an issue and include:
- Your operating system and Bun version (`bun --version`)
- The command you ran (hide any sensitive URLs or tokens)
- The expected behavior vs the actual behavior
- If the CLI crashed, include the full error output.

### Suggesting Enhancements
We love new ideas! When suggesting a feature:
- Explain **why** the enhancement is needed.
- Detail the proposed behavior or CLI flags.
- Provide a clear use case or example.

### Submitting Pull Requests
1. **Fork** the repository and create your branch from `main`.
2. **Install dependencies**: `bun install`
3. **Make your changes**. Keep them focused on a single logical fix or feature.
4. **Test your changes**:
   - Write tests for new features or regression tests for bug fixes in `tests/`.
   - Run the full suite: `bun test`
5. **Lint your code**: 
   - `bun run lint`
   - You can auto-fix formatting issues using `bun run lint:fix`
6. **Submit a PR**: Ensure your PR description clearly describes the problem and solution.

## Development Setup

`gdrive-dl` is built with [Bun](https://bun.sh/) and TypeScript.

### Prerequisites
- Bun v1.3 or higher

### Local Setup
```bash
git clone https://github.com/your-username/gdrive-dl.git
cd gdrive-dl
bun install
```

### Running Locally
You can run the CLI directly from source during development:
```bash
bun run src/cli.ts --help
```

### Release Workflow
Releases are completely automated via GitHub Actions:
1. Contributors submit PRs targeting the `main` branch.
2. The repository owner merges `main` into the `release` branch.
3. The CI/CD pipeline automatically:
   - Bumps the version in `package.json`
   - Commits the new version and creates a Git tag
   - Compiles native binaries for macOS, Windows, and Linux
   - Publishes a new GitHub Release with auto-generated release notes

### Testing
We use Bun's built-in test runner. Tests are located in the `tests/` directory.
```bash
bun test
```

### Architecture Overview
If you're looking to understand how the project is structured, check out the [WIKI](docs/WIKI.md) and [SPEC](docs/SPEC.md) files in the `docs/` directory. They contain detailed breakdowns of the module responsibilities and architectural decisions.

Thank you for contributing!
