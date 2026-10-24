#!/usr/bin/env node
/** Repository-local source launcher; implementation lives under src/lab. */
import { pathToFileURL } from "node:url";
import { main } from "../src/lab/cli.js";
export * from "../src/lab/cli.js";

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
  process.exitCode = await main(process.argv.slice(2));
}
