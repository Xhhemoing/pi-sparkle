import { randomInt } from "node:crypto";
import type { Server } from "node:http";

/**
 * Some hosts allocate port 0 inside Fetch's blocked-port range (observed: 1723).
 * Bind a dynamic high port instead, keeping the real fetch/HTTP path intact.
 * See https://fetch.spec.whatwg.org/#port-blocking.
 */
export async function listenOnLoopbackForFetch(server: Server): Promise<number> {
  if (server.listening) throw new Error("loopback test server is already listening");
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const port = randomInt(49_152, 65_536);
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          server.off("error", onError);
          server.off("listening", onListening);
        };
        const onError = (error: Error): void => { cleanup(); reject(error); };
        const onListening = (): void => { cleanup(); resolve(); };
        server.once("error", onError);
        server.once("listening", onListening);
        try { server.listen(port, "127.0.0.1"); }
        catch (error) { cleanup(); reject(error); }
      });
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        throw new Error("loopback test server did not bind a TCP port");
      }
      return address.port;
    } catch (error) {
      const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
      // Windows reserved ports can report EACCES rather than EADDRINUSE.
      if (code !== "EADDRINUSE" && code !== "EACCES") throw error;
      if (attempt === 31) throw new Error("loopback test server exhausted 32 port allocations", { cause: error });
    }
  }
  throw new Error("unreachable loopback allocation state");
}
