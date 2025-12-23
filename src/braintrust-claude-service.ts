import Anthropic from '@anthropic-ai/sdk';
import { initLogger, loadPrompt, traced, Span } from 'braintrust';
import { ConversationMessage } from './types';

// Braintrust configuration for the Beta bot
const BRAINTRUST_PROJECT_NAME = 'On Site Agent';
const BRAINTRUST_PROMPT_SLUG = 'core-8fbc';

// Fallback system prompt in case Braintrust prompt loading fails
const FALLBACK_SYSTEM_PROMPT = `You are a knowledgeable guide helping users explore the Jewish textual tradition through Sefaria's library and the Jewish calendar through Hebcal.`;

// Pricing per million tokens (as of Dec 2024)
// See: https://www.anthropic.com/pricing
const PRICING = {
  'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
} as const;

/**
 * Calculate cost in USD from token usage
 */
function calculateCost(
  model: keyof typeof PRICING,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number = 0,
  cacheReadTokens: number = 0
): number {
  const pricing = PRICING[model] || PRICING['claude-sonnet-4-5-20250929'];
  // Cache creation costs 25% more than input, cache read costs 90% less
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const cacheCreationCost = (cacheCreationTokens / 1_000_000) * pricing.input * 1.25;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.input * 0.1;
  return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}

/**
 * BraintrustClaudeService - Claude service with Braintrust observability and prompt versioning
 * 
 * Features:
 * - Observability via traced() wrapper at workflow level
 * - Dynamic prompt loading from Braintrust for version control
 * - MCP tool integration for Sefaria and Hebcal
 */
export class BraintrustClaudeService {
  private client: Anthropic;
  private mcpServerUrl: string;
  private projectName: string;
  private systemPrompt: string | null = null;
  private promptMetadata: Record<string, any> | null = null;
  private promptId: string | null = null;
  private promptVersion: string | null = null;
  private initialized: boolean = false;

  constructor(
    apiKey: string,
    mcpServerUrl: string,
    projectName: string = BRAINTRUST_PROJECT_NAME
  ) {
    this.mcpServerUrl = mcpServerUrl;
    this.projectName = projectName;

    // Initialize Braintrust logger for the project
    initLogger({
      projectName: this.projectName,
      apiKey: process.env.BRAINTRUST_API_KEY,
    });

    // Create Anthropic client (tracing handled at workflow level via traced())
    this.client = new Anthropic({ apiKey });

    console.log(`🧠 [BRAINTRUST] Service created for project "${projectName}"`);
  }

  /**
   * Initialize the service by loading the prompt from Braintrust
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    console.log(`🧠 [BRAINTRUST] Loading prompt from Braintrust (slug: ${BRAINTRUST_PROMPT_SLUG})...`);

    try {
      const prompt = await loadPrompt({
        projectName: this.projectName,
        slug: BRAINTRUST_PROMPT_SLUG,
      });

      // Store prompt ID and version directly from the Prompt object
      // These are the canonical identifiers for the prompt version
      this.promptId = prompt.id || null;
      this.promptVersion = prompt.version || null;

      // Build the prompt without query to extract the system message
      // We'll inject the actual user messages separately
      const builtPrompt = prompt.build({});
      
      // Store prompt metadata for reference (access via the built prompt)
      this.promptMetadata = builtPrompt.span_info?.metadata?.prompt || null;
      
      // Extract the system message from the built prompt
      const systemMessage = builtPrompt.messages?.find(
        (msg: any) => msg.role === 'system'
      );
      
      if (systemMessage?.content) {
        // Handle content being either a string or array of content blocks
        const content = systemMessage.content;
        if (typeof content === 'string') {
          this.systemPrompt = content;
        } else if (Array.isArray(content)) {
          // Extract text from content blocks
          this.systemPrompt = content
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('\n');
        } else {
          this.systemPrompt = FALLBACK_SYSTEM_PROMPT;
        }
        
        console.log(`✅ [BRAINTRUST] Prompt loaded successfully (id: ${this.promptId}, version: ${this.promptVersion})`);
        console.log(`✅ [BRAINTRUST] System prompt length: ${this.systemPrompt.length} chars`);
      } else {
        console.warn(`⚠️ [BRAINTRUST] No system message found in prompt, using fallback`);
        this.systemPrompt = FALLBACK_SYSTEM_PROMPT;
      }

      this.initialized = true;
    } catch (error) {
      console.error(`❌ [BRAINTRUST] Failed to load prompt:`, error);
      console.warn(`⚠️ [BRAINTRUST] Using fallback system prompt`);
      this.systemPrompt = FALLBACK_SYSTEM_PROMPT;
      this.initialized = true;
    }
  }

  /**
   * Send a message to Claude with MCP tools and Braintrust tracing
   */
  async sendMessage(messages: ConversationMessage[]): Promise<string> {
    await this.ensureInitialized();

    console.log(`🧠 [BRAINTRUST] Starting Claude call with ${messages.length} messages...`);

    // Wrap the LLM call in traced() for Braintrust observability
    return traced(
      async (span: Span) => {
        try {
          const requestPayload = {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 8000,
            temperature: 0,
            messages: messages.map(msg => ({
              role: msg.role as 'user' | 'assistant',
              content: msg.content
            })),
            system: this.systemPrompt!,
            mcp_servers: [
              {
                type: 'url' as const,
                url: this.mcpServerUrl,
                name: 'sefaria'
              },
              {
                type: 'url' as const,
                url: 'https://www.hebcal.com/mcp',
                name: 'hebcal'
              }
            ]
          };

          // Log input to Braintrust span
          const userMessage = messages.find(m => m.role === 'user')?.content || '';
          span.log({
            input: userMessage,
            metadata: {
              model: 'claude-sonnet-4-5-20250929',
              messageCount: messages.length,
              systemPromptLength: this.systemPrompt?.length || 0,
            },
          });

          console.log('📤 [BRAINTRUST] Sending request to Claude...');

          const response = await this.client.messages.create(requestPayload as any, {
            headers: {
              'anthropic-beta': 'mcp-client-2025-04-04'
            }
          });

          // Extract usage data
          const usage = response.usage;
          const inputTokens = usage.input_tokens;
          const outputTokens = usage.output_tokens;
          const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
          const cacheReadTokens = usage.cache_read_input_tokens || 0;
          const totalTokens = inputTokens + outputTokens + cacheCreationTokens;
          const cost = calculateCost('claude-sonnet-4-5-20250929', inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens);

          console.log('📊 [BRAINTRUST] Token usage:', {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: cacheCreationTokens,
            cache_read_input_tokens: cacheReadTokens,
            total_tokens: totalTokens,
            cost_usd: cost.toFixed(6),
          });

          // Log response content blocks for debugging
          console.log('📥 [BRAINTRUST] Response content blocks:');
          response.content.forEach((block, index) => {
            const blockAny = block as any;
            console.log(`Block ${index}:`, {
              type: block.type,
              ...(block.type === 'text' && { 
                text: block.text.substring(0, 200) + (block.text.length > 200 ? '...' : '') 
              }),
              ...(blockAny.type === 'mcp_tool_use' && { 
                name: blockAny.name,
                server_name: blockAny.server_name
              }),
              ...(blockAny.type === 'mcp_tool_result' && { 
                tool_use_id: blockAny.tool_use_id,
                is_error: blockAny.is_error
              })
            });
          });

          // Extract text content from response
          // MCP responses can have multiple text blocks interspersed with tool calls.
          // Claude often outputs partial text, calls tools, gets results, and repeats.
          // The FINAL text block is typically the complete synthesized response.
          const textBlocks: string[] = [];
          const toolUses: any[] = [];
          const toolResults: any[] = [];

          for (const content of response.content) {
            const contentAny = content as any;
            if (content.type === 'text') {
              textBlocks.push(content.text);
            } else if (contentAny.type === 'mcp_tool_use') {
              console.log('🔧 [BRAINTRUST] MCP tool used:', contentAny.name);
              toolUses.push(contentAny);
            } else if (contentAny.type === 'mcp_tool_result') {
              console.log('🔧 [BRAINTRUST] MCP tool result received');
              toolResults.push(contentAny);
            }
          }

          console.log('📊 [BRAINTRUST] Response summary:', {
            textBlocks: textBlocks.length,
            toolUses: toolUses.length,
            toolResults: toolResults.length
          });

          // Create child spans for each MCP tool call for Braintrust dashboard aggregation
          // This allows Braintrust to count tool calls properly
          for (const toolUse of toolUses) {
            const matchingResult = toolResults.find((r: any) => r.tool_use_id === toolUse.id);
            const isError = matchingResult?.is_error === true;
            
            // Extract the actual tool output content
            // MCP tool results have content as an array of content blocks
            let toolOutput = 'No result';
            if (matchingResult?.content) {
              // Content can be an array of content blocks or a string
              if (Array.isArray(matchingResult.content)) {
                toolOutput = matchingResult.content
                  .map((block: any) => block.text || JSON.stringify(block))
                  .join('\n');
              } else if (typeof matchingResult.content === 'string') {
                toolOutput = matchingResult.content;
              } else {
                toolOutput = JSON.stringify(matchingResult.content);
              }
            }
            
            span.traced(
              (toolSpan: Span) => {
                toolSpan.log({
                  input: JSON.stringify(toolUse.input || {}),
                  output: toolOutput,
                  ...(isError ? { error: matchingResult?.content?.[0]?.text || 'Tool execution failed' } : {}),
                  metadata: {
                    tool_name: toolUse.name,
                    server_name: toolUse.server_name,
                    tool_use_id: toolUse.id,
                    is_error: isError,
                  },
                });
              },
              { name: `mcp-tool:${toolUse.name}`, type: 'tool' }
            );
          }

          // Use the longest text block (typically the final complete response)
          // This handles cases where Claude outputs partial text before tool calls
          let responseText = '';
          if (textBlocks.length > 0) {
            // Find the longest text block - this is usually the final synthesized response
            responseText = textBlocks.reduce((longest, current) => 
              current.length > longest.length ? current : longest, '');
            
            console.log(`📝 [BRAINTRUST] Selected longest text block (${responseText.length} chars) from ${textBlocks.length} blocks`);
            
            // Log if there were multiple blocks (indicates tool-use pattern)
            if (textBlocks.length > 1) {
              console.log('📝 [BRAINTRUST] Text block lengths:', textBlocks.map(b => b.length));
            }
          }

          // Handle empty or incomplete response - try follow-up synthesis
          // Check for incomplete responses that contain raw tool invocation XML
          const hasIncompleteToolCall = responseText.includes('<invoke') || 
                                         responseText.includes('<parameter') ||
                                         responseText.includes('</invoke>');
          
          if (!responseText || responseText.trim().length === 0 || hasIncompleteToolCall) {
            if (hasIncompleteToolCall) {
              console.warn('⚠️ [BRAINTRUST] Response contains incomplete tool invocation XML, attempting synthesis...');
            } else {
              console.warn('⚠️ [BRAINTRUST] Empty response, attempting synthesis...');
            }
            const synthesized = await this.synthesizeResponse(messages);
            span.log({ output: synthesized });
            return synthesized;
          }

          // Count tool errors from MCP results
          const toolErrors = toolResults.filter((r: any) => r.is_error === true);
          const toolErrorCount = toolErrors.length;
          
          if (toolErrorCount > 0) {
            console.warn(`⚠️ [BRAINTRUST] ${toolErrorCount} tool error(s) detected`);
          }

          // Log output to Braintrust span with metrics
          span.log({
            output: responseText,
            metadata: {
              toolUsesCount: toolUses.length,
              toolResultsCount: toolResults.length,
              toolErrorCount: toolErrorCount,
              responseLength: responseText.length,
              toolNames: toolUses.map((t: any) => t.name),
            },
            metrics: {
              tokens: totalTokens,
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              cache_creation_input_tokens: cacheCreationTokens,
              cache_read_input_tokens: cacheReadTokens,
              cost: cost,
              // Counts for Braintrust dashboard aggregation
              llm_calls: 1,
              tool_calls: toolUses.length,
              tool_errors: toolErrorCount,
            },
          });

          console.log(`✅ [BRAINTRUST] Response received (${responseText.length} chars)`);
          return responseText;

        } catch (error) {
          console.error('❌ [BRAINTRUST] Error in sendMessage:', error);
          // Log the error to Braintrust for LLM error tracking
          span.log({
            error: error instanceof Error ? error.message : String(error),
            metadata: {
              errorType: 'llm_error',
              errorStack: error instanceof Error ? error.stack : undefined,
            },
          });
          throw error;
        }
      },
      { name: 'claude-sonnet-mcp-call', type: 'llm' }
    );
  }

  /**
   * Attempt to synthesize a response when Claude only returns tool results
   */
  private async synthesizeResponse(originalMessages: ConversationMessage[]): Promise<string> {
    console.log('🔄 [BRAINTRUST] Making follow-up call to synthesize results...');

    // Wrap synthesis call in traced() for Braintrust observability
    return traced(
      async (span: Span) => {
        const followUpMessages = [
          ...originalMessages,
          { 
            role: 'assistant' as const, 
            content: '[Tool calls completed - data gathered from sources]' 
          },
          { 
            role: 'user' as const, 
            content: 'Please provide your final answer based on the sources you just consulted.' 
          }
        ];

        span.log({
          input: 'Synthesis request after tool calls',
          metadata: { model: 'claude-sonnet-4-5-20250929', messageCount: followUpMessages.length },
        });

        try {
          const response = await this.client.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 2000,
            temperature: 0,
            messages: followUpMessages.map(msg => ({
              role: msg.role,
              content: msg.content
            })),
            system: `Based on the sources you just consulted, provide a complete response with proper citations.

SLACK FORMATTING:
• Bold text: *bold text* (single asterisks only)
• Italic text: _italic text_ (underscores only)
• Headers: *Header Text* (bold, no # symbols)
• Bullets: • Bullet point (use bullet character)
• Links: <https://www.sefaria.org/Genesis.3.4|Genesis 3:4> (angle brackets with pipe separator)
• For Sefaria URLs: replace spaces with underscores, replace colons with periods
• No markdown headers (#, ##, ###) - use *bold* instead
• No double asterisks (**) - use single asterisks (*)`
          } as any);

          // Extract usage data for synthesis call
          const usage = response.usage;
          const inputTokens = usage.input_tokens;
          const outputTokens = usage.output_tokens;
          const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
          const cacheReadTokens = usage.cache_read_input_tokens || 0;
          const totalTokens = inputTokens + outputTokens + cacheCreationTokens;
          const cost = calculateCost('claude-sonnet-4-5-20250929', inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens);

          let synthesisText = '';
          for (const content of response.content) {
            if (content.type === 'text') {
              synthesisText += content.text;
            }
          }

          if (synthesisText && synthesisText.trim().length > 0) {
            console.log(`✅ [BRAINTRUST] Synthesis successful (${synthesisText.length} chars)`);
            span.log({ 
              output: synthesisText,
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
            return synthesisText;
          }
        } catch (error) {
          console.error('❌ [BRAINTRUST] Synthesis failed:', error);
          // Log the error to Braintrust for LLM error tracking
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
        }

        const fallback = 'I apologize, but I was unable to generate a complete response. Please try rephrasing your question.';
        span.log({ 
          output: fallback, 
          metadata: { fallback: true },
          metrics: { llm_calls: 1 },
        });
        return fallback;
      },
      { name: 'claude-synthesis-call', type: 'llm' }
    );
  }

  /**
   * Format response for Slack using Claude
   */
  async formatForSlack(response: string): Promise<string> {
    // Wrap formatting call in traced() for Braintrust observability
    return traced(
      async (span: Span) => {
        try {
          console.log('🛠️ [BRAINTRUST-FORMAT] Starting Slack formatting...');

          span.log({
            input: response.substring(0, 500) + (response.length > 500 ? '...' : ''),
            metadata: { model: 'claude-sonnet-4-5-20250929', inputLength: response.length },
          });

          const formattingResponse = await this.client.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 12000,
            temperature: 0,
            messages: [{
              role: 'user',
              content: `Convert this response to proper Slack formatting.

CRITICAL REQUIREMENT: Include the COMPLETE content. Do not truncate or summarize.

Formatting rules:
• Bold text: *bold text* (single asterisks only)
• Italic text: _italic text_ (underscores only)
• Headers: *Header Text* (bold, no # symbols)
• Bullets: • Bullet point (use bullet character)
• Links: <https://www.sefaria.org/Genesis.3.4|Genesis 3:4> (angle brackets with pipe separator)
• For Sefaria URLs: replace spaces with underscores, replace colons with periods
• Convert HTML links to <url|text> format
• No markdown headers (#, ##, ###)
• No double asterisks (**)
• No HTML tags

Response to convert:
${response}`
            }]
          });

          // Extract usage data for formatting call
          const usage = formattingResponse.usage;
          const inputTokens = usage.input_tokens;
          const outputTokens = usage.output_tokens;
          const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
          const cacheReadTokens = usage.cache_read_input_tokens || 0;
          const totalTokens = inputTokens + outputTokens + cacheCreationTokens;
          const cost = calculateCost('claude-sonnet-4-5-20250929', inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens);

          const formattedText = formattingResponse.content
            .filter(block => block.type === 'text')
            .map(block => (block as any).text)
            .join('');

          console.log('🛠️ [BRAINTRUST-FORMAT] Formatting completed');
          span.log({ 
            output: formattedText, 
            metadata: { outputLength: formattedText.length },
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
          return formattedText || response;

        } catch (error) {
          console.error('❌ [BRAINTRUST-FORMAT] Error:', error);
          span.log({ 
            output: response, 
            error: error instanceof Error ? error.message : String(error),
            metadata: { 
              errorType: 'llm_error',
              fallback: true,
              errorStack: error instanceof Error ? error.stack : undefined,
            },
            metrics: {
              llm_calls: 1,
              llm_errors: 1,
            },
          });
          return response;
        }
      },
      { name: 'slack-format-call', type: 'llm' }
    );
  }

  /**
   * Get prompt metadata for debugging/logging
   */
  getPromptMetadata(): Record<string, any> | null {
    return this.promptMetadata;
  }

  /**
   * Get the core prompt tags for use in Braintrust span logs.
   * Returns an array of formatted tags like ["core-prompt-id:abc123", "core-prompt-ver:xyz789"]
   */
  getCorePromptTags(): string[] {
    const tags: string[] = [];
    if (this.promptId) {
      tags.push(`core-prompt-id:${this.promptId}`);
    }
    if (this.promptVersion) {
      tags.push(`core-prompt-ver:${this.promptVersion}`);
    }
    return tags;
  }

  /**
   * Get the prompt ID directly
   */
  getPromptId(): string | null {
    return this.promptId;
  }

  /**
   * Get the prompt version (transaction ID) directly
   */
  getPromptVersion(): string | null {
    return this.promptVersion;
  }

  /**
   * Cleanup (no-op for this service, but maintains interface compatibility)
   */
  async cleanup(): Promise<void> {
    console.log(`🧹 [BRAINTRUST] Cleanup completed`);
  }
}


