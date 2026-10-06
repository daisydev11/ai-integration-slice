import { ApiError, GoogleGenAI, type Part } from "@google/genai";
import { aiConfig, type RoleName } from "@/lib/ai/config";
import { roles } from "@/lib/ai/prompts";

// The only file that talks to the model provider. It uses Google's official
// SDK (@google/genai); there are no hand-written HTTP calls to the model API.

export type ModelFailure = "NO_API_KEY" | "TIMEOUT" | "PROVIDER_ERROR" | "PROVIDER_REJECTED";

export class ModelCallError extends Error {
  constructor(
    public code: ModelFailure,
    message: string,
    /** Whether trying again could plausibly work. */
    public retryable: boolean,
  ) {
    super(message);
  }
}

export type ModelReply = {
  rawText: string;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

let client: GoogleGenAI | undefined;
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ModelCallError("NO_API_KEY", "GEMINI_API_KEY is not set on the server.", false);
  // GEMINI_BASE_URL is only set in development, to point the SDK at the local simulator.
  const baseUrl = process.env.GEMINI_BASE_URL || undefined;
  client ??= new GoogleGenAI({ apiKey, httpOptions: baseUrl ? { baseUrl } : undefined });
  return client;
}

/** One call to one model, for one role, with that role's prompt, parameters, schema and timeout. */
export async function callModel(input: { role: RoleName; model: string; parts: Part[]; schema: Record<string, unknown> }): Promise<ModelReply> {
  const settings = aiConfig.roles[input.role];
  const signal = AbortSignal.timeout(settings.timeoutMs);
  try {
    const response = await getClient().models.generateContent({
      model: input.model,
      contents: [{ role: "user", parts: input.parts }],
      config: {
        systemInstruction: roles[input.role].systemPrompt,
        temperature: settings.temperature,
        maxOutputTokens: settings.maxOutputTokens,
        responseMimeType: "application/json",
        responseJsonSchema: input.schema,
        abortSignal: signal,
        httpOptions: { timeout: settings.timeoutMs },
      },
    });
    const usage = response.usageMetadata;
    return {
      rawText: response.text ?? "",
      finishReason: response.candidates?.[0]?.finishReason ?? null,
      inputTokens: usage?.promptTokenCount ?? null,
      // Reasoning tokens are billed as output, so they are counted as output here.
      outputTokens: usage ? (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) : null,
    };
  } catch (error) {
    if (error instanceof ModelCallError) throw error;
    if (signal.aborted) {
      throw new ModelCallError("TIMEOUT", `No reply from ${input.model} within ${settings.timeoutMs / 1000}s.`, true);
    }
    if (error instanceof ApiError) {
      // 429 and 5xx are the provider's problem and worth another try.
      // Other 4xx mean the provider will not accept this request as it stands.
      const retryable = error.status === 429 || error.status >= 500;
      throw new ModelCallError(retryable ? "PROVIDER_ERROR" : "PROVIDER_REJECTED", `${input.model} answered HTTP ${error.status}.`, retryable);
    }
    throw new ModelCallError("PROVIDER_ERROR", `Could not reach ${input.model}: ${error instanceof Error ? error.message : "unknown error"}`, true);
  }
}
