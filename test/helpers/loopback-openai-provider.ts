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

export interface LoopbackToolCallSpec {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  readonly id?: string;
}

/**
 * One scripted chat-completions response. Prefer toolCalls for agent turns that
 * must exercise real tools; text alone never invokes tools.
 */
export interface LoopbackScriptedResponse {
  readonly text?: string;
  readonly toolCalls?: readonly LoopbackToolCallSpec[];
  /** Non-2xx JSON error instead of SSE (provider failure). */
  readonly httpStatus?: number;
  readonly errorMessage?: string;
}

export interface LoopbackOpenAiProviderOptions {
  readonly modelIds: readonly [string, ...string[]];
  readonly responseText?: (requestNumber: number) => string;
  /**
   * Multi-turn / tool-call scripting. When set, overrides `responseText` for
   * that request. `requestNumber` is 1-based in arrival order.
   */
  readonly scriptedResponse?: (
    requestNumber: number,
    body: Record<string, unknown>
  ) => LoopbackScriptedResponse;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  /** OpenAI-style cached prompt tokens (prompt_tokens_details.cached_tokens). */
  readonly cachedTokens?: number;
  /** Send no usage block at all (provider silence on usage). */
  readonly omitUsage?: boolean;
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

function usageFields(
  options: LoopbackOpenAiProviderOptions
): Record<string, unknown> | undefined {
  if (options.omitUsage === true) return undefined;
  const promptTokens = options.promptTokens ?? 11;
  const completionTokens = options.completionTokens ?? 5;
  const cachedTokens = options.cachedTokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    ...(cachedTokens > 0 ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {})
  };
}

function writeSse(response: ServerResponse, chunks: readonly unknown[]): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.end("data: [DONE]\n\n");
}

function sendTextCompletion(
  response: ServerResponse,
  requestNumber: number,
  modelId: string,
  text: string,
  options: LoopbackOpenAiProviderOptions
): void {
  const id = `chatcmpl-loopback-${requestNumber}`;
  const created = 1_787_595_200 + requestNumber;
  const usage = usageFields(options);
  const finalChoice = {
    index: 0,
    delta: {},
    finish_reason: "stop"
  };
  const chunks: unknown[] = [
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
      choices: [finalChoice],
      ...(usage !== undefined ? { usage } : {})
    }
  ];
  writeSse(response, chunks);
}

function sendToolCallCompletion(
  response: ServerResponse,
  requestNumber: number,
  modelId: string,
  toolCalls: readonly LoopbackToolCallSpec[],
  options: LoopbackOpenAiProviderOptions
): void {
  const id = `chatcmpl-loopback-${requestNumber}`;
  const created = 1_787_595_200 + requestNumber;
  const usage = usageFields(options);
  const chunks: unknown[] = [];

  for (let i = 0; i < toolCalls.length; i += 1) {
    const call = toolCalls[i]!;
    const callId = call.id ?? `call_loopback_${requestNumber}_${i}`;
    const argsJson = JSON.stringify(call.arguments);
    chunks.push({
      id,
      object: "chat.completion.chunk",
      created,
      model: modelId,
      choices: [
        {
          index: 0,
          delta: {
            role: i === 0 ? "assistant" : undefined,
            content: null,
            tool_calls: [
              {
                index: i,
                id: callId,
                type: "function",
                function: { name: call.name, arguments: "" }
              }
            ]
          },
          finish_reason: null
        }
      ]
    });
    chunks.push({
      id,
      object: "chat.completion.chunk",
      created,
      model: modelId,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: i,
                function: { arguments: argsJson }
              }
            ]
          },
          finish_reason: null
        }
      ]
    });
  }

  chunks.push({
    id,
    object: "chat.completion.chunk",
    created,
    model: modelId,
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    ...(usage !== undefined ? { usage } : {})
  });

  writeSse(response, chunks);
}

function sendCompletion(
  response: ServerResponse,
  requestNumber: number,
  modelId: string,
  body: Record<string, unknown>,
  options: LoopbackOpenAiProviderOptions
): void {
  const scripted = options.scriptedResponse?.(requestNumber, body);
  if (scripted !== undefined) {
    if (scripted.httpStatus !== undefined && scripted.httpStatus >= 400) {
      sendJsonError(
        response,
        scripted.httpStatus,
        scripted.errorMessage ?? `loopback provider error ${scripted.httpStatus}`
      );
      return;
    }
    if (scripted.toolCalls !== undefined && scripted.toolCalls.length > 0) {
      sendToolCallCompletion(response, requestNumber, modelId, scripted.toolCalls, options);
      return;
    }
    sendTextCompletion(
      response,
      requestNumber,
      modelId,
      scripted.text ?? `loopback response ${requestNumber}`,
      options
    );
    return;
  }

  const text = options.responseText?.(requestNumber) ?? `loopback response ${requestNumber}`;
  sendTextCompletion(response, requestNumber, modelId, text, options);
}

/**
 * Minimal loopback implementation of the OpenAI chat-completions streaming
 * protocol used by custom providers. It intentionally performs real HTTP I/O:
 * tests exercise Pi's provider transport rather than replacing the Models API.
 *
 * Optional `scriptedResponse` can emit tool_calls SSE deltas so integration
 * tests drive real AgentTool execution through `createConfiguredPiExecutor`.
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

    if (requests.length > 20) {
      protocolErrors.push(`loopback request cap exceeded (${requests.length})`);
      sendJsonError(response, 429, "loopback request cap exceeded");
      return;
    }

    sendCompletion(response, requests.length, body.model, body, options);
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
