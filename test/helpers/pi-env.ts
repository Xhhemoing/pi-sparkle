/**
 * Ambient pi sessions (or user shells) may export PI_PROVIDER / PI_MODEL /
 * PI_FAST_MODEL. Without isolation these leak into the CLI's default model
 * resolution and make integration tests environment-dependent.
 *
 * Saves the variables, unsets them for the duration of the test body, and
 * restores them afterwards (including on failure).
 */
const PI_ENV_KEYS = ["PI_PROVIDER", "PI_MODEL", "PI_FAST_MODEL"] as const;

export async function withIsolatedPiEnv<T>(run: () => Promise<T>): Promise<T> {
  const saved = PI_ENV_KEYS.map((key) => ({ key, value: process.env[key] }));
  for (const { key } of saved) delete process.env[key];
  try {
    return await run();
  } finally {
    for (const { key, value } of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
