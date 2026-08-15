import { readFile } from "node:fs/promises";
import { DomainValidationError } from "../domain/errors.js";
import {
  validateConfidenceScore,
  validateFlowchart,
  type Flowchart
} from "../domain/flowchart.js";
import { isRecord } from "../domain/record.js";
import type { ChildNodeResult } from "../supervisor/flowchart-supervisor.js";
import { assertFlowchartModelsInCatalog } from "./model-catalog.js";

export async function readJsonFile(path: string, label: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new DomainValidationError(
      `Invalid ${label} ${path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function parseFlowchartFile(path: string): Promise<Flowchart> {
  const flowchart = validateFlowchart(await readJsonFile(path, "flowchart spec"));
  assertFlowchartModelsInCatalog(flowchart);
  return flowchart;
}

function parseChildNodeResult(nodeId: string, value: unknown): ChildNodeResult {
  if (!isRecord(value)) {
    throw new DomainValidationError(`results.${nodeId} must be an object`);
  }
  if (value.outcome !== "SUCCESS" && value.outcome !== "PARTIAL" && value.outcome !== "FAILURE") {
    throw new DomainValidationError(`results.${nodeId}.outcome must be SUCCESS, PARTIAL, or FAILURE`);
  }
  let evidenceIds: readonly string[] | undefined;
  if (value.evidenceIds !== undefined) {
    if (!Array.isArray(value.evidenceIds) || !value.evidenceIds.every((id) => typeof id === "string" && id.trim() !== "")) {
      throw new DomainValidationError(`results.${nodeId}.evidenceIds must be an array of non-empty strings`);
    }
    evidenceIds = value.evidenceIds;
  }
  let facts: ChildNodeResult["facts"];
  if (value.facts !== undefined) {
    if (!Array.isArray(value.facts)) {
      throw new DomainValidationError(`results.${nodeId}.facts must be an array`);
    }
    facts = value.facts.map((fact, index) => {
      if (!isRecord(fact) || typeof fact.key !== "string" || fact.key.trim() === "") {
        throw new DomainValidationError(`results.${nodeId}.facts[${index}].key must be a non-empty string`);
      }
      if (typeof fact.value !== "string") {
        throw new DomainValidationError(`results.${nodeId}.facts[${index}].value must be a string`);
      }
      return {
        key: fact.key,
        value: fact.value,
        confidence: validateConfidenceScore(fact.confidence, `results.${nodeId}.facts[${index}].confidence`)
      };
    });
  }
  return {
    outcome: value.outcome,
    ...(value.confidence !== undefined
      ? { confidence: validateConfidenceScore(value.confidence, `results.${nodeId}.confidence`) }
      : {}),
    ...(evidenceIds !== undefined ? { evidenceIds } : {}),
    ...(facts !== undefined ? { facts } : {})
  };
}

export function parseChildNodeResults(value: unknown): Readonly<Record<string, ChildNodeResult>> {
  if (!isRecord(value)) {
    throw new DomainValidationError("results file must be a JSON object mapping nodeId to ChildNodeResult");
  }
  const results: Record<string, ChildNodeResult> = {};
  for (const [nodeId, raw] of Object.entries(value)) {
    if (nodeId.trim() === "") {
      throw new DomainValidationError("results file must not use an empty node id");
    }
    results[nodeId] = parseChildNodeResult(nodeId, raw);
  }
  return results;
}

export async function parseChildNodeResultsFile(
  path: string
): Promise<Readonly<Record<string, ChildNodeResult>>> {
  return parseChildNodeResults(await readJsonFile(path, "results"));
}

/**
 * Merges repeatable `--selected` flags with a `--selected-ids` CSV.
 * `undefined` means the user omitted both flags; `[]` is an explicit empty selection.
 */
export function collectSelectedActionIds(
  selected: readonly string[] | undefined,
  selectedIdsCsv: string | undefined
): string[] | undefined {
  if (selected === undefined && selectedIdsCsv === undefined) return undefined;
  const fromCsv =
    selectedIdsCsv === undefined
      ? []
      : selectedIdsCsv
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id !== "");
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const id of [...(selected ?? []), ...fromCsv]) {
    if (id.trim() === "") {
      throw new DomainValidationError("selected action ids must be non-empty");
    }
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}
