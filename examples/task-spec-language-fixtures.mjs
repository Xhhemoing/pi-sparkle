// Synthetic, healthy projects. No dependencies or interpreter are copied into source.
import { readFileSync } from "node:fs";
import path from "node:path";

export const LANGUAGES = ["node-express", "python-fastapi", "rust-cli", "go-service"];
const TYPECHECK_SOURCE = readFileSync(new URL("./task-spec-typescript-check.mjs", import.meta.url), "utf8");

export function typescriptExampleFiles({ packageAnchor }) {
  if (typeof packageAnchor !== "string" || !path.isAbsolute(packageAnchor)) throw new Error("TypeScript example requires an explicit absolute dependency package anchor");
  return {
    "tsconfig.json": `${JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
      strict: true, noEmit: true, incremental: false, pretty: false, allowImportingTsExtensions: true,
      types: ["node"], typeRoots: [path.join(path.dirname(packageAnchor), "node_modules/@types")] }, include: ["src/**/*", "test/**/*"] }, null, 2)}\n`,
    "typecheck/config.json": `${JSON.stringify({ packageAnchor, requiredTypes: ["@types/node"] }, null, 2)}\n`,
    "typecheck/check.mjs": TYPECHECK_SOURCE
  };
}

export function configureTypeScriptExample(draft) {
  const protect = [...new Set([...draft.write.protect, "*.json", "typecheck"])];
  return { ...draft, write: { ...draft.write, protect }, checks: [
    { id: "typescript-typecheck", command: process.execPath, args: ["typecheck/check.mjs"], verifierVersion: "example-typescript-v1",
      protectedPaths: ["package.json", "typecheck"], timeoutMs: 20000, visibleToWorker: true, expect: { baseline: "pass" } },
    ...draft.checks.map((check) => ({ ...check,
      ...(check.protectedPaths === undefined ? {} : { protectedPaths: [...check.protectedPaths] }) }))
  ] };
}

function nodeExpress(packageAnchor) {
  if (!packageAnchor) throw new Error("node-express requires --node-deps pointing to an external Express installation prefix");
  const before = `import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const config = JSON.parse(readFileSync(new URL('../runtime-config.json', import.meta.url), 'utf8'));
const express: typeof import('express') = createRequire(config.packageAnchor)('express');

export function total(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

export function createApp() {
  const app = express();
  app.use(express.json());
  app.post('/total', (request, response) => response.json({ total: total(request.body.values) }));
  return app;
}
`;
  const typed = typescriptExampleFiles({ packageAnchor });
  const tsconfig = JSON.parse(typed["tsconfig.json"]);
  tsconfig.compilerOptions.paths = { express: [path.join(path.dirname(packageAnchor), "node_modules/@types/express/index.d.ts")] };
  typed["tsconfig.json"] = `${JSON.stringify(tsconfig, null, 2)}\n`;
  typed["typecheck/config.json"] = `${JSON.stringify({ packageAnchor, requiredTypes: ["@types/node", "@types/express"] }, null, 2)}\n`;
  return {
    sourceFile: "src/app.ts", before,
    after: before.replace("  return values.reduce((sum, value) => sum + value, 0);", "  let result = 0;\n  for (const value of values) result += value;\n  return result;"),
    objective: "Refactor the Express total helper to an explicit loop while preserving every HTTP result and all protected inputs.",
    files: {
      ...typed,
      "package.json": `${JSON.stringify({ name: "sparkle-express-example", version: "0.0.0", private: true, type: "module", scripts: { test: "node --test test/app.test.ts" } }, null, 2)}\n`,
      "runtime-config.json": `${JSON.stringify({ packageAnchor }, null, 2)}\n`,
      "test/app.test.ts": `import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { test } from 'node:test';
import { createApp } from '../src/app.ts';

test('real Express loopback HTTP preserves duplicate, empty and negative totals', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    for (const [values, expected] of [[[2, 2, 3], 7], [[], 0], [[5, -2, -2], 1]] as [number[], number][]) {
      const payload = JSON.stringify({ values });
      const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
        const call = request({ hostname: '127.0.0.1', port: address.port, path: '/total', method: 'POST', agent: false,
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (incoming) => {
          let text = '';
          incoming.setEncoding('utf8');
          incoming.on('data', (chunk) => { text += chunk; });
          incoming.on('error', reject);
          incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, text }));
        });
        call.on('error', reject);
        call.end(payload);
      });
      assert.equal(response.status, 200);
      assert.deepEqual(JSON.parse(response.text), { total: expected });
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
`
    }
  };
}

function pythonFastapi() {
  const before = `from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class TotalRequest(BaseModel):
    values: list[int]


@app.post("/total")
def total(payload: TotalRequest) -> dict[str, int]:
    return {"total": sum(payload.values)}
`;
  return {
    sourceFile: "src/total_api/app.py", before,
    after: before.replace('    return {"total": sum(payload.values)}', '    result = 0\n    for value in payload.values:\n        result += value\n    return {"total": result}'),
    objective: "Refactor the FastAPI total endpoint to an explicit accumulation loop without changing validation or results.",
    files: {
      "src/total_api/__init__.py": "",
      "requirements.txt": "fastapi\nhttpx\npytest\nruff\n",
      "pyproject.toml": `[project]
name = "sparkle-fastapi-example"
version = "0.0.0"
requires-python = ">=3.12"
dependencies = ["fastapi"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]

[tool.ruff]
target-version = "py312"
line-length = 88

[tool.ruff.lint]
select = ["E4", "E7", "E9", "F", "I"]
`,
      "tests/test_total.py": `import pytest
from fastapi.testclient import TestClient

from total_api.app import app


@pytest.mark.parametrize("values, expected", [([2, 2, 3], 7), ([], 0), ([5, -2, -2], 1)])
def test_real_fastapi_total(values, expected):
    with TestClient(app) as client:
        response = client.post("/total", json={"values": values})
    assert response.status_code == 200
    assert response.json() == {"total": expected}


def test_real_fastapi_validation():
    with TestClient(app) as client:
        response = client.post("/total", json={"values": ["invalid"]})
    assert response.status_code == 422
`
    }
  };
}

function rustCli() {
  const before = `fn main() {
    let values: Vec<i64> = std::env::args().skip(1).map(|value| value.parse().expect("integer argument")).collect();
    let total: i64 = values.iter().sum();
    println!("{total}");
}
`;
  return {
    sourceFile: "src/main.rs", before,
    after: before.replace("    let total: i64 = values.iter().sum();", "    let mut total: i64 = 0;\n    for value in values { total += value; }"),
    objective: "Refactor the Rust CLI sum to an explicit loop while preserving actual process output for every protected test.",
    files: {
      "Cargo.toml": '[package]\nname = "sparkle_demo"\nversion = "0.1.0"\nedition = "2021"\n',
      "Cargo.lock": 'version = 4\n\n[[package]]\nname = "sparkle_demo"\nversion = "0.1.0"\n',
      "tests/cli.rs": `use std::process::Command;

#[test]
fn actual_cli_totals() {
    for (args, expected) in [(vec!["2", "2", "3"], "7"), (vec![], "0"), (vec!["5", "-2", "-2"], "1")] {
        let output = Command::new(env!("CARGO_BIN_EXE_sparkle_demo")).args(args).output().expect("run real CLI");
        assert!(output.status.success());
        assert_eq!(String::from_utf8(output.stdout).unwrap().trim(), expected);
        assert!(output.stderr.is_empty());
    }
}
`
    }
  };
}

function goService() {
  const before = `package service

import (
	"encoding/json"
	"net/http"
)

func TotalHandler(response http.ResponseWriter, request *http.Request) {
	var input struct { Values []int \`json:"values"\` }
	if err := json.NewDecoder(request.Body).Decode(&input); err != nil {
		http.Error(response, "invalid values", http.StatusBadRequest)
		return
	}
	total := 0
	for _, value := range input.Values { total += value }
	response.Header().Set("Content-Type", "application/json")
	json.NewEncoder(response).Encode(struct { Total int \`json:"total"\` }{total})
}
`;
  return {
    sourceFile: "service.go", before,
    after: before.replace("\ttotal := 0\n\tfor _, value := range input.Values { total += value }", "\ttotal := sum(input.Values)") +
      "\nfunc sum(values []int) int {\n\tresult := 0\n\tfor _, value := range values { result += value }\n\treturn result\n}\n",
    objective: "Extract the Go service accumulation helper while preserving actual HTTP handler responses.",
    files: {
      "go.mod": "module example.invalid/sparkle-demo\n\ngo 1.22\n",
      "service_test.go": `package service

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestActualHTTPHandler(t *testing.T) {
	for index, values := range [][]int{{2, 2, 3}, {}, {5, -2, -2}} {
		payload, err := json.Marshal(map[string][]int{"values": values})
		if err != nil { t.Fatal(err) }
		request := httptest.NewRequest(http.MethodPost, "/total", bytes.NewReader(payload))
		response := httptest.NewRecorder()
		TotalHandler(response, request)
		if response.Code != http.StatusOK { t.Fatalf("unexpected HTTP status: %d", response.Code) }
		var actual struct { Total int \`json:"total"\` }
		if err := json.Unmarshal(response.Body.Bytes(), &actual); err != nil { t.Fatal(err) }
		if actual.Total != []int{7, 0, 1}[index] { t.Fatalf("incorrect response total: %d", actual.Total) }
	}
}
`
    }
  };
}

export function languageFixture(language, options = {}) {
  const fixture = language === "node-express" ? nodeExpress(options.packageAnchor)
    : language === "python-fastapi" ? pythonFastapi()
      : language === "rust-cli" ? rustCli() : language === "go-service" ? goService() : undefined;
  if (!fixture) throw new Error(`Unknown demo language: ${language}`);
  if (fixture.before === fixture.after) throw new Error("The scripted edit must actually change the source bytes");
  return { ...fixture, files: { ".gitignore": "target/\n__pycache__/\n.pytest_cache/\n.ruff_cache/\n", ...fixture.files, [fixture.sourceFile]: fixture.before } };
}
