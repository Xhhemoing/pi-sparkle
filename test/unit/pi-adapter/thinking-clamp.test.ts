import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampThinkingLevel,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  getSupportedThinkingLevels,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type GoogleApiThinkingLevel,
  type Model,
  type ModelThinkingLevel,
  type ResolvedGoogleThinkingLevel,
  type SimpleStreamOptions
} from "@earendil-works/pi-ai";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { PiAgentExecutor, type SparkleThinkingLevel } from "../../../src/pi-adapter/pi-executor.js";
import { createAgentInstanceId, createRunId, createTaskId } from "../../../src/domain/ids.js";
import type { ModelInvocation } from "../../../src/telemetry/model-invocation.js";

/**
 * Characterization, not specification: this file records what Pi 0.84.3 does
 * with "xhigh"/"max" so the CLI's claim ("Google models silently clamp
 * xhigh/max") stays true across pin bumps. Nothing here asks this repo to
 * clamp — the adapter forwards the requested level and the provider decides.
 * A failure here means Pi's behaviour moved and the docs/USAGE need an edit,
 * not that the adapter regressed.
 */

/** Runs one faux-provider turn and reports what reached the provider. */
async function runWithThinkingLevel(
  thinkingLevel: SparkleThinkingLevel
): Promise<{ reasoning: unknown; parameterHash: string }> {
  const faux = fauxProvider({ provider: "alpha", models: [{ id: "one", name: "One" }] });
  faux.setResponses([fauxAssistantMessage("ok")]);
  const models = createModels();
  models.setProvider(faux.provider);

  const seen: SimpleStreamOptions[] = [];
  const forward = models.streamSimple.bind(models);
  models.streamSimple = (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ): AssistantMessageEventStream => {
    if (options !== undefined) seen.push(options);
    return forward(model, context, options);
  };

  const invocations: ModelInvocation[] = [];
  const executor = new PiAgentExecutor({
    providerId: "alpha",
    modelId: "one",
    models,
    thinkingLevel,
    onInvocation: (invocation) => invocations.push(invocation)
  });

  for await (const event of executor.execute(
    {
      runId: createRunId(),
      taskId: createTaskId(),
      agentInstanceId: createAgentInstanceId(),
      prompt: "hi",
      workingDirectory: "."
    },
    new AbortController().signal
  )) {
    void event;
  }

  assert.equal(seen.length, 1);
  assert.equal(invocations.length, 1);
  return {
    reasoning: (seen[0] as SimpleStreamOptions & Record<string, unknown>).reasoning,
    parameterHash: invocations[0]!.config.parameterHash
  };
}

describe("the adapter forwards the requested thinking level", () => {
  it("hands xhigh and max to Pi unchanged", async () => {
    for (const level of ["high", "xhigh", "max"] as const) {
      const { reasoning } = await runWithThinkingLevel(level);
      assert.equal(reasoning, level, `expected ${level} to reach the provider unclamped`);
    }
  });

  it("records the requested level in telemetry, so a clamped run stays distinguishable", async () => {
    const hashes = new Set<string>();
    for (const level of ["high", "xhigh", "max"] as const) {
      hashes.add((await runWithThinkingLevel(level)).parameterHash);
    }
    assert.equal(hashes.size, 3);
  });
});

function googleModels(): Model<Api>[] {
  return [
    ...(getBuiltinModels("google") as Model<Api>[]),
    ...(getBuiltinModels("google-vertex") as Model<Api>[])
  ].filter((model) => model.reasoning);
}

describe("Pi's Google clamp, as shipped in the pinned pi-ai", () => {
  it("offers no Google model that accepts xhigh or max", () => {
    const offenders = googleModels()
      .filter((model) => {
        const levels: readonly ModelThinkingLevel[] = getSupportedThinkingLevels(model);
        return levels.includes("xhigh") || levels.includes("max");
      })
      .map((model) => `${model.provider}/${model.id}`);
    assert.ok(googleModels().length > 0, "the pinned catalog should still ship Google models");
    // If this ever fails, Google gained a level above HIGH: revisit the
    // "Google models silently clamp xhigh/max" line in USAGE and the how-to.
    assert.deepEqual(offenders, []);
  });

  it("clamps a requested xhigh or max down to the model's top level", () => {
    for (const model of googleModels()) {
      const supported: readonly ModelThinkingLevel[] = getSupportedThinkingLevels(model);
      for (const requested of ["xhigh", "max"] as const) {
        const clamped = clampThinkingLevel(model, requested);
        assert.notEqual(clamped, requested, `${model.provider}/${model.id} did not clamp ${requested}`);
        assert.ok(
          supported.includes(clamped),
          `${model.provider}/${model.id} clamped ${requested} to unsupported ${clamped}`
        );
        assert.equal(clamped, "high", `${model.provider}/${model.id} clamped ${requested} to ${clamped}`);
      }
    }
  });

  it("leaves xhigh alone on models that advertise it, so the clamp is a model capability", () => {
    const keepsXhigh = getBuiltinProviders()
      .flatMap((provider) => getBuiltinModels(provider) as Model<Api>[])
      .filter((model) => {
        const levels: readonly ModelThinkingLevel[] = getSupportedThinkingLevels(model);
        return levels.includes("xhigh");
      });
    assert.ok(keepsXhigh.length > 0, "expected at least one builtin model to advertise xhigh");
    for (const model of keepsXhigh) {
      assert.equal(clampThinkingLevel(model, "xhigh"), "xhigh", `${model.provider}/${model.id}`);
    }
  });
});

/** True only when the two unions have exactly the same members. */
type SameUnion<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

describe("Google's thinking-level types top out at HIGH", () => {
  it("matches what docs/how-to-adapt-to-pi.md tells maintainers", () => {
    // Compile-time assertions: a widened Google union fails typecheck here,
    // at the one place that documents it, rather than silently.
    const apiLevelsStopAtHigh: SameUnion<
      GoogleApiThinkingLevel,
      "THINKING_LEVEL_UNSPECIFIED" | "MINIMAL" | "LOW" | "MEDIUM" | "HIGH"
    > = true;
    const resolvedExcludesTopLevels: SameUnion<
      ResolvedGoogleThinkingLevel,
      Exclude<SparkleThinkingLevel, "off" | "xhigh" | "max">
    > = true;
    assert.equal(apiLevelsStopAtHigh, true);
    assert.equal(resolvedExcludesTopLevels, true);
  });
});
