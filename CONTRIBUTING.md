# Contributing to pi-sparkle

Thank you for your interest in contributing to pi-sparkle. This document provides guidelines and instructions for contributing.

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

# Run quality gates
pnpm typecheck
pnpm lint
pnpm test
pnpm build
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
  preference/  # Preference detection and storage
test/          # Test suites (unit + integration)
docs/          # Specifications, ADRs, research
tasks/         # Planning and task tracking
```

## Quality Gates

All contributions must pass:

| Command | Purpose |
|---------|---------|
| `pnpm typecheck` | TypeScript strict mode validation |
| `pnpm lint` | ESLint checks |
| `pnpm test` | Unit and integration tests (tsx --test) |
| `pnpm build` | Production build (tsconfig.build.json) |

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

## Code Style

- Strict TypeScript (no implicit any, exact optional properties)
- NoUncheckedIndexedAccess and verbatimModuleSyntax enabled
- Follow existing patterns in `src/` and `test/`

## Questions

Open an issue with the `question` label for clarification before implementing large changes.
