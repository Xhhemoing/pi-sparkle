model: gpt-5.6-sol-xhigh-fast

# R3 GPT-A — CI Node pin

## Outcome

- Pinned the `quality` and `cli-smoke` matrices to Node.js `22.19.0`.
- Documented that `engines.node` is `>=22.19.0`, ensuring the quality job's
  security probe certifies on a compliant host.
- Left `package.json` and `src/` unchanged.

## Verification

- Confirmed both CI matrices use `node-version: ["22.19.0"]`.
- Confirmed no `22.x` Node matrix remains in `.github/workflows/ci.yml`.
