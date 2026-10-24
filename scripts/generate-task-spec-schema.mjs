import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { developmentTaskSpecSchema } from "../src/development/task-spec-schema.ts";

const directory = fileURLToPath(new URL("../schema/", import.meta.url));
await mkdir(directory, { recursive: true });
await writeFile(new URL("../schema/taskspec.v1.json", import.meta.url), `${JSON.stringify(developmentTaskSpecSchema, null, 2)}\n`, "utf8");
console.log("Wrote schema/taskspec.v1.json");
