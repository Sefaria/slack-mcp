import Anthropic from '@anthropic-ai/sdk';
import { initLogger, traced } from 'braintrust';

// Braintrust configuration
const BRAINTRUST_PROJECT_NAME = 'On Site Agent';

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
    async (span: { log: (data: Record<string, unknown>) => void }) => {
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
    async (span: { log: (data: Record<string, unknown>) => void }) => {
      span.log({
        input: userPrompt.substring(0, 200),
        metadata: { model: 'claude-haiku-4-5-20251001', spanName },
      });

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as any).text)
        .join('');

      span.log({ output: text });

      return text;
    },
    { name: spanName }
  );
}

