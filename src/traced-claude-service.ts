import { ChatAnthropic } from '@langchain/anthropic';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { StateGraph, Annotation, messagesStateReducer } from '@langchain/langgraph';
import { ConversationMessage } from './types';

// Traced Claude service using ChatAnthropic for LangSmith visibility
export class TracedClaudeService {
  private model: ChatAnthropic;
  private mcpClient: MultiServerMCPClient | null = null;
  private mcpServerUrl: string;
  private projectName: string;
  private systemPrompt: string;
  private initialized: boolean = false;

  constructor(
    apiKey: string,
    mcpServerUrl: string,
    projectName: string,
    systemPrompt: string
  ) {
    this.mcpServerUrl = mcpServerUrl;
    this.projectName = projectName;
    this.systemPrompt = systemPrompt;

    // Initialize ChatAnthropic with project name for LangSmith tracing
    this.model = new ChatAnthropic({
      model: 'claude-sonnet-4-5-20250929',
      temperature: 0.7,
      maxTokens: 8000,
      anthropicApiKey: apiKey,
      // LangSmith configuration - traces will be tagged with bot name
      callbacks: undefined, // Will be set per-invocation if needed
    });

    console.log(`🔧 TracedClaudeService created for project "${projectName}"`);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    console.log(`🔧 Initializing MCP client for ${this.projectName}...`);

    try {
      // Configure Sefaria MCP server
      this.mcpClient = new MultiServerMCPClient({
        mcpServers: {
          'sefaria': {
            url: this.mcpServerUrl,
            transport: 'http'
          }
        }
      });

      this.initialized = true;
      console.log(`✅ MCP client initialized for ${this.projectName}`);
    } catch (error) {
      console.error(`❌ Failed to initialize MCP client for ${this.projectName}:`, error);
      throw error;
    }
  }

  async sendMessage(messages: ConversationMessage[]): Promise<string> {
    await this.ensureInitialized();

    console.log(`🤖 [${this.projectName.toUpperCase()}] Starting traced Claude call...`);
    console.log(`🤖 [${this.projectName.toUpperCase()}] Message count: ${messages.length}`);

    try {
      // Get MCP tools
      const tools = await this.mcpClient!.getTools();
      console.log(`🔧 [${this.projectName.toUpperCase()}] Retrieved ${tools.length} MCP tools`);

      // Bind tools to the model
      const modelWithTools = this.model.bindTools(tools);

      // Convert conversation messages to LangChain format
      const langchainMessages: BaseMessage[] = [
        new SystemMessage(this.systemPrompt)
      ];

      for (const msg of messages) {
        if (msg.role === 'user') {
          langchainMessages.push(new HumanMessage(msg.content));
        } else if (msg.role === 'assistant') {
          langchainMessages.push(new AIMessage(msg.content));
        }
      }

      console.log(`📤 [${this.projectName.toUpperCase()}] Invoking model with ${langchainMessages.length} messages...`);

      // Create a simple agent loop for tool use
      let response = await modelWithTools.invoke(langchainMessages, {
        metadata: {
          project_name: this.projectName,
          bot_name: this.projectName
        },
        tags: [this.projectName, 'slack-mcp']
      });

      // Handle tool calls in a loop
      let iterations = 0;
      const maxIterations = 10;

      while (response.tool_calls && response.tool_calls.length > 0 && iterations < maxIterations) {
        iterations++;
        console.log(`🔧 [${this.projectName.toUpperCase()}] Iteration ${iterations}: Processing ${response.tool_calls.length} tool calls...`);

        // Add AI response with tool calls to message history
        langchainMessages.push(response);

        // Execute each tool call
        for (const toolCall of response.tool_calls) {
          console.log(`🔧 [${this.projectName.toUpperCase()}] Executing tool: ${toolCall.name}`);

          // Find the matching tool
          const tool = tools.find(t => t.name === toolCall.name);
          if (tool) {
            try {
              const toolResult = await tool.invoke(toolCall.args);
              console.log(`✅ [${this.projectName.toUpperCase()}] Tool ${toolCall.name} completed`);

              // Add tool result as a tool message
              langchainMessages.push({
                role: 'tool',
                content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
                tool_call_id: toolCall.id,
                name: toolCall.name
              } as any);
            } catch (toolError) {
              console.error(`❌ [${this.projectName.toUpperCase()}] Tool ${toolCall.name} failed:`, toolError);
              langchainMessages.push({
                role: 'tool',
                content: `Error: ${toolError instanceof Error ? toolError.message : String(toolError)}`,
                tool_call_id: toolCall.id,
                name: toolCall.name
              } as any);
            }
          } else {
            console.warn(`⚠️ [${this.projectName.toUpperCase()}] Tool ${toolCall.name} not found`);
          }
        }

        // Get next response from model
        response = await modelWithTools.invoke(langchainMessages, {
          metadata: {
            project_name: this.projectName,
            bot_name: this.projectName,
            iteration: iterations
          },
          tags: [this.projectName, 'slack-mcp', 'tool-followup']
        });
      }

      if (iterations >= maxIterations) {
        console.warn(`⚠️ [${this.projectName.toUpperCase()}] Reached max iterations (${maxIterations})`);
      }

      // Extract text content from response
      const responseText = typeof response.content === 'string'
        ? response.content
        : Array.isArray(response.content)
          ? response.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('')
          : '';

      console.log(`✅ [${this.projectName.toUpperCase()}] Response received (${responseText.length} chars)`);

      if (!responseText || responseText.trim().length === 0) {
        console.warn(`⚠️ [${this.projectName.toUpperCase()}] Empty response, attempting synthesis...`);

        // Try one more call asking for synthesis
        langchainMessages.push(new HumanMessage('Please provide your final answer based on the information gathered.'));

        const synthesisResponse = await modelWithTools.invoke(langchainMessages, {
          metadata: {
            project_name: this.projectName,
            bot_name: this.projectName,
            phase: 'synthesis'
          },
          tags: [this.projectName, 'slack-mcp', 'synthesis']
        });

        const synthesisText = typeof synthesisResponse.content === 'string'
          ? synthesisResponse.content
          : Array.isArray(synthesisResponse.content)
            ? synthesisResponse.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('')
            : '';

        if (synthesisText && synthesisText.trim().length > 0) {
          console.log(`✅ [${this.projectName.toUpperCase()}] Synthesis successful (${synthesisText.length} chars)`);
          return synthesisText;
        }

        return 'I apologize, but I was unable to generate a complete response. Please try rephrasing your question.';
      }

      return responseText;

    } catch (error) {
      console.error(`❌ [${this.projectName.toUpperCase()}] Error in sendMessage:`, error);
      throw error;
    }
  }

  async formatForSlack(response: string): Promise<string> {
    try {
      console.log(`🛠️ [${this.projectName.toUpperCase()}-FORMAT] Starting Slack formatting...`);

      const formattingPrompt = `Convert this response to proper Slack formatting.

CRITICAL REQUIREMENT: You MUST include the COMPLETE content of the input in your output. Do not truncate, summarize, or ask if the user wants you to continue. Convert the ENTIRE response.

Follow these formatting rules exactly:

• Bold text: *bold text* (single asterisks only)
• Italic text: _italic text_ (underscores only)
• Headers: *Header Text* (bold, no # symbols)
• Bullets: • Bullet point (use bullet character)
• Links: <https://www.sefaria.org/Genesis.3.4|Genesis 3:4> (angle brackets with pipe separator)
• For Sefaria URLs: replace internal spaces with underscores, replace space before verses and verse colons with periods
• Convert HTML links like <a href="url">text</a> to <url|text>
• No markdown headers (#, ##, ###) - use *bold* instead
• No double asterisks (**) - use single asterisks (*)
• No HTML tags at all

Response to convert (CONVERT EVERYTHING, DO NOT TRUNCATE):
${response}`;

      const formattingResponse = await this.model.invoke([
        new HumanMessage(formattingPrompt)
      ], {
        metadata: {
          project_name: this.projectName,
          phase: 'formatting'
        },
        tags: [this.projectName, 'formatting']
      });

      const formattedText = typeof formattingResponse.content === 'string'
        ? formattingResponse.content
        : Array.isArray(formattingResponse.content)
          ? formattingResponse.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('')
          : response;

      console.log(`🛠️ [${this.projectName.toUpperCase()}-FORMAT] Formatting completed`);
      return formattedText || response;

    } catch (error) {
      console.error(`❌ [${this.projectName.toUpperCase()}-FORMAT] Error:`, error);
      return response;
    }
  }

  async cleanup(): Promise<void> {
    if (this.mcpClient) {
      try {
        if (typeof (this.mcpClient as any).close === 'function') {
          await (this.mcpClient as any).close();
        }
        this.mcpClient = null;
        this.initialized = false;
        console.log(`🧹 [${this.projectName.toUpperCase()}] Cleanup completed`);
      } catch (error) {
        console.error(`⚠️ [${this.projectName.toUpperCase()}] Cleanup error:`, error);
      }
    }
  }
}
