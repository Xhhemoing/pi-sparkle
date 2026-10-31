# Design: Multi-provider API configuration on Pi

Date: 2026-08-19  
Status: Accepted (brainstorm 2026-08-19; implementation in the same session)

## 1. Problem

pi-sparkle treats provider, model, and secret as one global triple (`PI_PROVIDER` / `PI_MODEL` / `PI_API_KEY`). Pi already supports per-provider env vars, a `CredentialStore`, `builtinModels()`, and per-request model identity. The adapter never registered built-in providers, so real `getModel()` lookups fail, and the live routing catalog is still fake `cheap` / `premium`.

## 2. Goals

- First-class multi-provider and multi-model configuration.
- Simple CLI: `auth` and `models`, no extra UI.
- Secrets never appear in events, status output, or `invocations.jsonl`.
- ADR-001: only `src/pi-adapter/` imports `@earendil-works/*`.
- Live routing stays R0-equivalent; this work does not enable R1/bandit.

## 3. Files

| Path | Role |
| --- | --- |
| `~/.pi-sparkle/auth.json` | Pi `CredentialStore` map `{ [providerId]: Credential }`. Stored credential wins over env. |
| `~/.pi-sparkle/providers.json` | Enabled catalog ids, `primary` / `fast`, optional custom OpenAI-compatible providers. No secrets. |

`--state-root` relocates both. Do not share cwd `auth.json` with the Pi CLI.

## 4. Identity

Canonical catalog id is `providerId/modelId` (split on the **first** `/`). Aliases:

- `cheap` → configured `fast` (default `cheap` fake row when nothing is enabled)
- `premium` → configured `primary`

## 5. Auth resolution

Pi native: stored credential, else provider env (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, …). `PI_API_KEY` is a compatibility override for the **default** provider only, not a global key for every vendor.

## 6. CLI

```
pi-sparkle auth status [--all] [--state-root]
pi-sparkle auth login <provider> [--key <key> | --from-env] [--oauth] [--state-root]
pi-sparkle auth logout <provider> [--state-root]
pi-sparkle models list [--available] [--provider <id>] [--state-root]
pi-sparkle models enable <provider/model> [--state-root]
pi-sparkle models disable <provider/model> [--state-root]
pi-sparkle models set-default --primary <id> [--fast <id>] [--state-root]
```

`--executor pi` no longer requires `PI_PROVIDER`+`PI_MODEL` when `providers.json` has an enabled primary. Empty config still accepts the old env triple.

## 7. Runtime

- Adapter builds `builtinModels({ credentials })` plus optional custom `createProvider()` rows.
- `PiAgentExecutor` honors `request.providerId` / `request.modelId` (including `provider/model` refs and cheap/premium aliases).
- Live catalog = enabled models (plus cheap/premium aliases). Prices and context windows come from Pi’s built-in catalog.
- Child attempts pass the routed identity through; cascade may switch provider.

## 8. Non-goals

- Dumping every built-in model into the live router.
- R1 / bandit / shadow in the live plane.
- Pi types outside `src/pi-adapter/`.
- Printing or logging secrets.
