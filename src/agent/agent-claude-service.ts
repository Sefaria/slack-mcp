import Anthropic from '@anthropic-ai/sdk';
import { sefariaAgentToolSchemas } from './agent-tool-schemas';
import { SefariaAgentTools } from './sefaria-agent-tools';
import { ConversationMessage } from '../types';
import { traced, Span } from 'braintrust';

type AnthropicMessageParam = {
  role: 'user' | 'assistant';
  content: any[];
};

export type AgentProgressUpdate =
  | { type: 'status'; text: string }
  | { type: 'tool_start'; toolName: string; input: unknown; description: string }
  | { type: 'tool_end'; toolName: string; isError: boolean; outputPreview?: string };

export type AgentSendMessageOptions = {
  onProgress?: (update: AgentProgressUpdate) => void;
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function safeInlineJson(value: unknown, maxLen: number = 400): string {
  try {
    return truncate(JSON.stringify(value), maxLen);
  } catch {
    return '[unserializable]';
  }
}

function describeToolCall(toolName: string, input: any): string {
  const q = (v: any) => (typeof v === 'string' ? `"${truncate(v, 140)}"` : safeInlineJson(v, 140));
  switch (toolName) {
    case 'text_search':
      return `Searching texts for ${q(input?.query)}${input?.filters?.length ? ` in ${q(input.filters)}` : ''}`;
    case 'english_semantic_search':
      return `Semantic search for ${q(input?.query)}`;
    case 'search_in_book':
      return `Searching in ${q(input?.book_name)} for ${q(input?.query)}`;
    case 'search_in_dictionaries':
      return `Searching dictionaries for ${q(input?.query)}`;
    case 'get_text':
      return `Fetching text ${q(input?.reference)}${input?.version_language ? ` (${q(input.version_language)})` : ''}`;
    case 'get_links_between_texts':
      return `Finding links from ${q(input?.reference)}`;
    case 'get_topic_details':
      return `Loading topic details for ${q(input?.topic_slug)}`;
    case 'get_current_calendar':
      return `Fetching current Jewish calendar`;
    case 'clarify_name_argument':
      return `Clarifying name ${q(input?.name)}`;
    case 'clarify_search_path_filter':
      return `Resolving book filter for ${q(input?.book_name)}`;
    case 'get_text_or_category_shape':
      return `Loading shape for ${q(input?.name)}`;
    case 'get_text_catalogue_info':
      return `Loading catalogue info for ${q(input?.title)}`;
    case 'get_available_manuscripts':
      return `Checking available manuscripts for ${q(input?.reference)}`;
    case 'get_manuscript_image':
      return `Downloading manuscript image`;
    default:
      return `Running tool ${q(toolName)} with ${safeInlineJson(input, 220)}`;
  }
}

export class AgentClaudeService {
  private client: Anthropic;
  private tools: SefariaAgentTools;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
    this.tools = new SefariaAgentTools();
  }

  async sendMessage(messages: ConversationMessage[], options?: AgentSendMessageOptions): Promise<string> {
    const conversation: AnthropicMessageParam[] = messages.map(m => ({
      role: m.role,
      content: [{ type: 'text', text: m.content }]
    }));

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const emit = (update: AgentProgressUpdate) => {
      try {
        options?.onProgress?.(update);
      } catch {
        // Never allow progress callbacks to break the agent.
      }
    };

    return traced(
      async (span: Span) => {
        let iterations = 0;
        let finalText = '';
        let llmCalls = 0;
        let toolCalls = 0;
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheCreationInputTokens = 0;
        let cacheReadInputTokens = 0;

        span.log({
          input: lastUserMessage.substring(0, 2000),
          metadata: { model: 'claude-sonnet-4-5-20250929' }
        });

        while (iterations < 10) {
          iterations++;
          llmCalls++;
          emit({ type: 'status', text: `Thinking (pass ${iterations})…` });

          const response = await this.client.messages.create(
            {
              model: 'claude-sonnet-4-5-20250929',
              max_tokens: 8000,
              temperature: 0.7,
              system: `You are a Jewish text scholar with access to internal Sefaria tools. Follow these guidelines:

RESPONSE REQUIREMENTS:
• Respond in the same language the user asked the question in
• Gauge user intent - provide short answers for simple questions, comprehensive analysis for complex ones
• ALL claims must be sourced and cited with Sefaria links: [Source Name](https://www.sefaria.org/Reference)
• If making unsourced claims, explicitly note: "Based on my analysis (not from a specific source):"
• CRITICAL: Provide ONLY your final scholarly response. NEVER include internal search processes, tool usage descriptions, or step-by-step research narrative
• Begin responses directly with substantive content about the topic
• FORBIDDEN PHRASES: "Let me search," "I'll gather," "Now let me," "I found," "Let me look," "I'll check," or any process descriptions
• Users should only see your final scholarly conclusions, not your research process

SLACK FORMATTING (use exactly as specified):
• Bold text: *bold text* (single asterisks only)
• Italic text: _italic text_ (underscores only) 
• Headers: *Header Text* (bold, no # symbols)
• Bullets: • Bullet point (use bullet character)
• Links: <https://www.sefaria.org/Genesis.3.4|Genesis 3:4> (angle brackets with pipe separator)
• No markdown headers (#, ##, ###) - use *bold* instead
• No double asterisks (**) - use single asterisks (*)`,
              messages: conversation as any,
              tools: sefariaAgentToolSchemas as any,
              tool_choice: { type: 'auto' } as any
            } as any
          );

          const usage: any = (response as any).usage || {};
          inputTokens += usage.input_tokens || 0;
          outputTokens += usage.output_tokens || 0;
          cacheCreationInputTokens += usage.cache_creation_input_tokens || 0;
          cacheReadInputTokens += usage.cache_read_input_tokens || 0;

          const blocks: any[] = (response as any).content || [];
          const toolUses = blocks.filter(b => b?.type === 'tool_use');
          const text = blocks.filter(b => b?.type === 'text').map(b => b.text).join('');
          finalText += text;

          // Always append the assistant's content to the conversation before tool results
          conversation.push({ role: 'assistant', content: blocks });

          if (!toolUses.length) {
            break;
          }

          for (const toolUse of toolUses) {
            toolCalls++;
            const toolUseId =
              toolUse.id || toolUse.tool_use_id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

            const toolDesc = describeToolCall(toolUse.name, toolUse.input || {});
            emit({
              type: 'tool_start',
              toolName: toolUse.name,
              input: toolUse.input || {},
              description: toolDesc
            });

            const toolResult = await (span as any).traced(
              async (toolSpan: Span) => {
                toolSpan.log({
                  input: JSON.stringify(toolUse.input || {}),
                  metadata: {
                    tool_name: toolUse.name,
                    tool_use_id: toolUseId
                  }
                });

                const result = await this.tools.execute(toolUse.name, toolUse.input || {});

                const toolOutput = result.content
                  .map((block: any) => (block?.type === 'text' ? block.text : JSON.stringify(block)))
                  .join('\n');

                emit({
                  type: 'tool_end',
                  toolName: toolUse.name,
                  isError: !!result.is_error,
                  outputPreview: truncate(toolOutput, 500)
                });

                toolSpan.log({
                  output: toolOutput,
                  ...(result.is_error ? { error: toolOutput } : {}),
                  metadata: {
                    tool_name: toolUse.name,
                    tool_use_id: toolUseId,
                    is_error: !!result.is_error
                  }
                });

                return result;
              },
              { name: `tool:${toolUse.name}`, type: 'tool' }
            );

            conversation.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseId,
                  content: toolResult.content,
                  is_error: toolResult.is_error
                }
              ]
            });
          }
        }

        emit({ type: 'status', text: 'Synthesizing response…' });

        const output =
          finalText.trim() || (iterations >= 10 ? 'Sorry, I hit a tool loop limit while processing your request.' : '');

        span.log({
          output,
          metadata: {
            outputLength: output.length,
            toolNames: conversation
              .flatMap(m => m.content || [])
              .filter((b: any) => b?.type === 'tool_use')
              .map((b: any) => b.name)
          },
          metrics: {
            llm_calls: llmCalls,
            tool_calls: toolCalls,
            prompt_tokens: inputTokens,
            completion_tokens: outputTokens,
            cache_creation_input_tokens: cacheCreationInputTokens,
            cache_read_input_tokens: cacheReadInputTokens,
            total_tokens: inputTokens + outputTokens + cacheCreationInputTokens
          }
        });

        return output || 'Sorry, I encountered an issue generating a response.';
      },
      { name: 'agentapi-claude-call', type: 'llm' }
    );
  }
}
