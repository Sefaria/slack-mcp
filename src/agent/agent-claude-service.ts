import Anthropic from '@anthropic-ai/sdk';
import { sefariaAgentToolSchemas } from './agent-tool-schemas';
import { SefariaAgentTools } from './sefaria-agent-tools';
import { ConversationMessage } from '../types';
import { traced, Span } from 'braintrust';

type AnthropicMessageParam = {
  role: 'user' | 'assistant';
  content: any[];
};

export class AgentClaudeService {
  private client: Anthropic;
  private tools: SefariaAgentTools;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
    this.tools = new SefariaAgentTools();
  }

  async sendMessage(messages: ConversationMessage[]): Promise<string> {
    const conversation: AnthropicMessageParam[] = messages.map(m => ({
      role: m.role,
      content: [{ type: 'text', text: m.content }]
    }));

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';

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
