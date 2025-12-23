import Anthropic from '@anthropic-ai/sdk';
import { initLogger, traced, Span } from 'braintrust';

// Braintrust configuration
const BRAINTRUST_PROJECT_NAME = 'On Site Agent';

// Pricing per million tokens (as of Dec 2024)
const HAIKU_PRICING = { input: 0.80, output: 4.00 };

/**
 * Calculate cost in USD from token usage for Haiku
 */
function calculateHaikuCost(
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number = 0,
  cacheReadTokens: number = 0
): number {
  const inputCost = (inputTokens / 1_000_000) * HAIKU_PRICING.input;
  const outputCost = (outputTokens / 1_000_000) * HAIKU_PRICING.output;
  const cacheCreationCost = (cacheCreationTokens / 1_000_000) * HAIKU_PRICING.input * 1.25;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * HAIKU_PRICING.input * 0.1;
  return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}

let initialized = false;
let cachedClient: Anthropic | null = null;

/**
 * Initialize Braintrust logging for the entire application.
 * Call this once at startup.
 */
export function initializeBraintrust(): void {
  if (initialized) return;

  initLogger({
    projectName: BRAINTRUST_PROJECT_NAME,
    apiKey: process.env.BRAINTRUST_API_KEY,
  });

  initialized = true;
  console.log(`🧠 [BRAINTRUST] Logger initialized for project "${BRAINTRUST_PROJECT_NAME}"`);
}

/**
 * Get an Anthropic client for use with Braintrust tracing.
 * Note: Use the traced() wrapper at the workflow level for observability.
 */
export function getTracedAnthropicClient(apiKey: string): Anthropic {
  initializeBraintrust();

  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey });
    console.log('🧠 [BRAINTRUST] Anthropic client created (use traced() for observability)');
  }

  return cachedClient!;
}

/**
 * Wrapper for traced function calls.
 * Use this to create spans around any operation.
 */
export async function tracedCall<T>(
  name: string,
  fn: () => Promise<T>,
  metadata?: Record<string, any>
): Promise<T> {
  initializeBraintrust();

  return traced(
    async (span: Span) => {
      if (metadata) {
        span.log({ metadata });
      }
      return await fn();
    },
    { name }
  );
}

/**
 * Make a traced LLM call using Haiku for lightweight tasks.
 * Used for emoji selection, formatting checks, etc.
 */
export async function tracedHaikuCall(
  client: Anthropic,
  spanName: string,
  systemPrompt: string,
  userPrompt: string,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const { maxTokens = 50, temperature = 0.7 } = options;

  return traced(
    async (span: Span) => {
      span.log({
        input: userPrompt.substring(0, 200),
        metadata: { model: 'claude-haiku-4-5-20251001', spanName },
      });

      try {
        const response = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: maxTokens,
          temperature,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });

        // Extract usage data
        const usage = response.usage;
        const inputTokens = usage.input_tokens;
        const outputTokens = usage.output_tokens;
        const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
        const cacheReadTokens = usage.cache_read_input_tokens || 0;
        const totalTokens = inputTokens + outputTokens + cacheCreationTokens;
        const cost = calculateHaikuCost(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens);

        const text = response.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as any).text)
          .join('');

        span.log({ 
          output: text,
          metrics: {
            tokens: totalTokens,
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            cache_creation_input_tokens: cacheCreationTokens,
            cache_read_input_tokens: cacheReadTokens,
            cost: cost,
            llm_calls: 1,
          },
        });

        return text;
      } catch (error) {
        console.error('❌ [BRAINTRUST] Haiku call failed:', error);
        span.log({
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            errorType: 'llm_error',
            errorStack: error instanceof Error ? error.stack : undefined,
          },
          metrics: {
            llm_calls: 1,
            llm_errors: 1,
          },
        });
        throw error;
      }
    },
    { name: spanName, type: 'llm' }
  );
}

