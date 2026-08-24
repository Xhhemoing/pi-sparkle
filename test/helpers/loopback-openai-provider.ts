import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface LoopbackProviderRequest {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export interface LoopbackOpenAiProvider {
  /** OpenAI-compatible base URL for customProviders[].baseUrl. */
  readonly baseUrl: string;
  readonly requests: LoopbackProviderRequest[];
  readonly protocolErrors: string[];
  close(): Promise<void>;
}

export interface LoopbackOpenAiProviderOptions {
  readonly modelIds: readonly [string, ...string[]];
  readonly responseText?: (requestNumber: number) => string;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJsonError(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { message } }));
}

function sendCompletion(
  response: ServerResponse,
  requestNumber: number,
  modelId: string,
  options: LoopbackOpenAiProviderOptions
): void {
  const id = `chatcmpl-loopback-${requestNumber}`;
  const created = 1_787_595_200 + requestNumber;
  const text = options.responseText?.(requestNumber) ?? `loopback response ${requestNumber}`;
  const promptTokens = options.promptTokens ?? 11;
  const completionTokens = options.completionTokens ?? 5;
  const chunks = [
    {
      id,
      object: "chat.completion.chunk",
      created,
      model: modelId,
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }]
    },
    {
      id,
      object: "chat.completion.chunk",
      created,
      model: modelId,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens
      }
    }
  ];

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.end("data: [DONE]\n\n");
}

/**
 * Minimal loopback implementation of the OpenAI chat-completions streaming
 * protocol used by custom providers. It intentionally performs real HTTP I/O:
 * tests exercise Pi's provider transport rather than replacing the Models API.
 */
export async function startLoopbackOpenAiProvider(
  options: LoopbackOpenAiProviderOptions
): Promise<LoopbackOpenAiProvider> {
  const requests: LoopbackProviderRequest[] = [];
  const protocolErrors: string[] = [];
  const server = createServer(async (request, response) => {
    let body: unknown;
    try {
      body = await readJsonBody(request);
    } catch {
      protocolErrors.push("request body was not valid JSON");
      sendJsonError(response, 400, "invalid JSON");
      return;
    }

    const authorization = Array.isArray(request.headers.authorization)
      ? request.headers.authorization.join(",")
      : request.headers.authorization;
    requests.push({ method: request.method, url: request.url, authorization, body });

    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      protocolErrors.push(`expected POST /v1/chat/completions, received ${request.method} ${request.url}`);
      sendJsonError(response, 404, "not found");
      return;
    }
    if (
      !isRecord(body) ||
      typeof body.model !== "string" ||
      !options.modelIds.includes(body.model) ||
      body.stream !== true
    ) {
      protocolErrors.push("request did not contain the configured model and stream=true");
      sendJsonError(response, 400, "invalid chat-completions request");
      return;
    }

    sendCompletion(response, requests.length, body.model, options);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("loopback provider did not bind a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    protocolErrors,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) reject(error);
          else resolve();
        });
      })
  };
}
