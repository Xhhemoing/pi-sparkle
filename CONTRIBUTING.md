# Contributing to pi-sparkle

Thank you for your interest in contributing to pi-sparkle. This document provides guidelines and instructions for contributing.

pi-sparkle is a Developer Preview with `"private": true`. It will not be
published to npm; clone the repository and use pnpm locally.

## Development Setup

### Prerequisites

- Node.js >= 22.19.0
- pnpm 10.17.1 (via corepack)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/Xhhemoing/pi-sparkle.git
cd pi-sparkle

# Install dependencies
corepack enable
pnpm install

# Run the merge-time quality gate (typecheck + lint + test + build)
pnpm gate
```

## Project Structure

```
src/           # Source code (TypeScript)
  cli/         # Command-line interface
  supervisor/  # M2 supervisor and flowchart routing
  episode/     # Episode management and replay
  requirement/ # Coverage, critic, precedence gates
  review/      # Actor-critic review system
  rubric/      # Evaluation rubrics
  preferences/ # Preference detection and storage
test/          # Test suites (unit + integration)
docs/          # Specifications, ADRs, research
examples/      # Reusable local CLI input examples
tasks/         # Planning and task tracking
```

## Running Tests

`pnpm test` wraps `tsx --test` through `scripts/run-tests.mjs`, which expands
directory arguments into their `*.test.ts` files (plain `tsx --test` cannot
import a directory). All three forms work:

```bash
pnpm test                                        # full suite
pnpm test -- test/unit/privacy                   # one directory, recursively
pnpm test -- test/unit/privacy/deletion.test.ts  # one file
```

## Quality Gates

All contributions must pass:

| Command | Purpose |
|---------|---------|
| `pnpm typecheck` | TypeScript strict mode validation |
| `pnpm lint` | ESLint checks |
| `pnpm test` | Unit and integration tests (see Running Tests above) |
| `pnpm build` | Production build (tsconfig.build.json) |
| `pnpm gate` | All four in sequence (merge-time gate) |
| `pnpm security:probe` | Built-artifact redaction and packaged-secret checks |
| `pnpm pi:probe` | Pi adapter-boundary and legacy-symbol checks |
| `pnpm prerelease` | `pnpm gate && pnpm security:probe && pnpm pi:probe`. Run before tagging a preview build |

## Commit Guidelines

- Use conventional commit format: `type(scope): description`
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- Reference milestone/task IDs when applicable (e.g., `M2-T11`)

## Pull Request Process

1. Create a feature branch from `main`
2. Implement changes with tests
3. Ensure all quality gates pass locally
4. Open a PR with a clear description of changes
5. Request review from maintainers

Contributors must follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report
security issues through [GitHub private vulnerability
reporting](SECURITY.md), never in a public issue when secrets or sensitive
data are involved.

## Code Style

- Strict TypeScript (no implicit any, exact optional properties)
- NoUncheckedIndexedAccess and verbatimModuleSyntax enabled
- Follow existing patterns in `src/` and `test/`

## Questions

Open an issue with the `question` label for clarification before implementing large changes.
