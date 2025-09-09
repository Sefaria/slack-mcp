import { createBaseWorkflow, WorkflowNodes } from './workflow-base';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import {
  validateMessageNode,
  sendAcknowledgmentNode,
  fetchContextNode,
  validateSlackFormattingNode,
  formatResponseNode,
  sendResponseNode,
  handleErrorNode
} from '../nodes';
import { SlackWorkflowState } from '../graph-types';

// Deep agent instance (cached)
let binahAgent: any = null;
let mcpClient: MultiServerMCPClient | null = null;

async function initializeBinahAgent() {
  if (binahAgent && mcpClient) {
    return { agent: binahAgent, client: mcpClient };
  }

  console.log('🧠 Initializing Binah deep agent with MCP integration...');
  
  try {
    // Dynamic import of deepagents (ES module) - use eval to prevent TypeScript compilation issues
    const deepAgentsModule = await eval('import("deepagents")');
    const { createDeepAgent } = deepAgentsModule;
    
    // Configure Sefaria MCP server
    mcpClient = new MultiServerMCPClient({
      mcpServers: {
        'sefaria': {
          url: process.env.SEFARIA_MCP_URL!,
          transport: 'http'
        }
      }
    });
    
    // Get all tools from MCP servers
    const tools = await mcpClient.getTools();
    console.log(`🔧 Retrieved ${tools.length} tools from MCP servers`);
    
    // Create deep agent with MCP tools and enhanced capabilities
    binahAgent = await createDeepAgent({
      tools: tools,
      instructions: `You are Binah (בינה), a deep research scholarly assistant specializing in comprehensive analysis of Jewish texts and traditions.

Your enhanced capabilities include:
- **Deep Research**: Break down complex scholarly questions into sub-tasks for thorough investigation
- **Comparative Analysis**: Compare sources across different texts, time periods, and traditions
- **Multi-layered Context**: Consider historical, linguistic, theological, and cultural dimensions
- **Planning and Reasoning**: Use systematic approaches for complex multi-step inquiries

**Core Guidelines:**
- Provide comprehensive, well-structured responses with clear reasoning
- Include relevant citations and Sefaria links for all claims
- Respond in the user's language (Hebrew, English, etc.)
- Adapt response depth to user intent (brief definitions vs comprehensive analysis)
- Add coverage warnings for topics outside Jewish textual sources
- Use planning tools for complex multi-part questions
- Consider multiple perspectives and interpretations where relevant

**Response Format for Slack:**
- Use proper Slack formatting (avoid HTML, use *bold* not **bold**)
- Convert links to Slack format: [text](url) → <url|text>
- Structure complex responses with clear sections
- Provide actionable insights and practical applications where appropriate

You have access to the Sefaria database through MCP tools for authentic source access.`
    });
    
    console.log('✅ Binah deep agent initialized successfully');
    return { agent: binahAgent, client: mcpClient };
    
  } catch (error) {
    console.error('❌ Failed to initialize Binah deep agent:', error);
    throw error;
  }
}

// Custom deep agent node for Binah
const callDeepAgentNode = async (state: SlackWorkflowState): Promise<Partial<SlackWorkflowState>> => {
  console.log('🧠 Calling Binah deep agent...');
  
  try {
    const { agent } = await initializeBinahAgent();
    
    // Prepare conversation for deep agent
    const messages = state.conversationContext.length > 0 
      ? state.conversationContext 
      : [{ 
          role: 'user' as const, 
          content: state.messageText || (state.slackEvent.text || '').replace(/<@[A-Z0-9]+>/g, '').trim()
        }];
    
    console.log(`🔄 Processing with ${messages.length} context messages...`);
    console.log(`📋 [DEEP-AGENT] Input messages:`, messages.map(m => `${m.role}: ${m.content.substring(0, 100)}...`));
    
    // Try streaming for observability, fallback to invoke if not supported
    console.log(`🧠 [DEEP-AGENT] Starting DeepAgent workflow with recursion limit 100...`);
    
    let result: any = null;
    
    try {
      // Attempt streaming for better observability
      console.log(`🧠 [DEEP-AGENT] Attempting streaming mode...`);
      let stepCount = 0;
      let lastState: any = null;
      
      // Check if streaming is available
      if (typeof agent.stream === 'function') {
        console.log(`🧠 [DEEP-AGENT] Using streaming (awaiting Promise)...`);
        const streamResult = await agent.stream({
          messages: messages
        }, {
          recursionLimit: 100
        });
        
        // Debug: Log what we got after awaiting
        console.log(`🔍 [DEEP-AGENT] Awaited result type: ${typeof streamResult}`);
        console.log(`🔍 [DEEP-AGENT] Awaited result constructor: ${streamResult?.constructor?.name}`);
        console.log(`🔍 [DEEP-AGENT] Has Symbol.iterator: ${streamResult && typeof streamResult[Symbol.iterator] === 'function'}`);
        console.log(`🔍 [DEEP-AGENT] Has Symbol.asyncIterator: ${streamResult && typeof streamResult[Symbol.asyncIterator] === 'function'}`);
        
        // Check if the result is iterable (sync or async)
        if (streamResult && typeof streamResult[Symbol.iterator] === 'function') {
          console.log(`🧠 [DEEP-AGENT] Using synchronous iteration...`);
          for (const chunk of streamResult) {
            stepCount++;
            const lastMsg = chunk.messages?.[chunk.messages.length - 1];
            
            console.log(`🧠 [DEEP-AGENT] Step ${stepCount}: ${chunk.messages?.length || 0} messages`);
            
            // Detect LangChain message types based on properties
            if (lastMsg) {
              if (lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
                const tool = lastMsg.tool_calls[0];
                const inputStr = tool.args ? JSON.stringify(tool.args) : (tool.input ? JSON.stringify(tool.input) : 'no input');
                console.log(`🔧 [DEEP-AGENT] Tool Call: ${tool.name} - ${inputStr.substring(0, 100)}...`);
              } else if (lastMsg.tool_call_id || lastMsg.lc_direct_tool_output) {
                console.log(`🔧 [DEEP-AGENT] Tool Result: ${typeof lastMsg.content === 'string' ? lastMsg.content.substring(0, 100) : JSON.stringify(lastMsg.content).substring(0, 100)}...`);
              } else if (lastMsg.content && typeof lastMsg.content === 'object' && Array.isArray(lastMsg.content)) {
                // Assistant message with structured content
                const textContent = lastMsg.content.find((c: any) => c.type === 'text');
                console.log(`🧠 [DEEP-AGENT] Assistant: ${textContent?.text?.substring(0, 150) || 'structured content'}...`);
              } else if (lastMsg.content && typeof lastMsg.content === 'string') {
                // Simple text content
                if (lastMsg.name) {
                  console.log(`🔧 [DEEP-AGENT] Tool/Function: ${lastMsg.content.substring(0, 100)}...`);
                } else {
                  console.log(`🧠 [DEEP-AGENT] Message: ${lastMsg.content.substring(0, 150)}...`);
                }
              } else {
                console.log(`❓ [DEEP-AGENT] Unknown message type: ${lastMsg.lc_namespace || 'no-namespace'}`);
              }
            }
          lastState = chunk;
          }
          result = lastState;
          console.log(`🧠 [DEEP-AGENT] Streaming completed after ${stepCount} steps`);
        } else if (streamResult && typeof streamResult[Symbol.asyncIterator] === 'function') {
          console.log(`🧠 [DEEP-AGENT] Using asynchronous iteration...`);
          for await (const chunk of streamResult) {
            stepCount++;
            const lastMsg = chunk.messages?.[chunk.messages.length - 1];
            
            console.log(`🧠 [DEEP-AGENT] Step ${stepCount}: ${chunk.messages?.length || 0} messages`);
            
            // Detect LangChain message types based on properties
            if (lastMsg) {
              if (lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
                const tool = lastMsg.tool_calls[0];
                const inputStr = tool.args ? JSON.stringify(tool.args) : (tool.input ? JSON.stringify(tool.input) : 'no input');
                console.log(`🔧 [DEEP-AGENT] Tool Call: ${tool.name} - ${inputStr.substring(0, 100)}...`);
              } else if (lastMsg.tool_call_id || lastMsg.lc_direct_tool_output) {
                console.log(`🔧 [DEEP-AGENT] Tool Result: ${typeof lastMsg.content === 'string' ? lastMsg.content.substring(0, 100) : JSON.stringify(lastMsg.content).substring(0, 100)}...`);
              } else if (lastMsg.content && typeof lastMsg.content === 'object' && Array.isArray(lastMsg.content)) {
                // Assistant message with structured content
                const textContent = lastMsg.content.find((c: any) => c.type === 'text');
                console.log(`🧠 [DEEP-AGENT] Assistant: ${textContent?.text?.substring(0, 150) || 'structured content'}...`);
              } else if (lastMsg.content && typeof lastMsg.content === 'string') {
                // Simple text content
                if (lastMsg.name) {
                  console.log(`🔧 [DEEP-AGENT] Tool/Function: ${lastMsg.content.substring(0, 100)}...`);
                } else {
                  console.log(`🧠 [DEEP-AGENT] Message: ${lastMsg.content.substring(0, 150)}...`);
                }
              } else {
                console.log(`❓ [DEEP-AGENT] Unknown message type: ${lastMsg.lc_namespace || 'no-namespace'}`);
              }
            }
            lastState = chunk;
          }
          result = lastState;
          console.log(`🧠 [DEEP-AGENT] Async streaming completed after ${stepCount} steps`);
        } else {
          throw new Error(`Stream result is not iterable. Type: ${typeof streamResult}, Constructor: ${streamResult?.constructor?.name}`);
        }
      } else {
        throw new Error('Streaming not available');
      }
    } catch (streamError) {
      console.log(`⚠️ [DEEP-AGENT] Streaming failed, falling back to invoke: ${streamError instanceof Error ? streamError.message : String(streamError)}`);
      
      // Fallback to regular invoke with enhanced logging
      console.log(`🧠 [DEEP-AGENT] Using standard invoke mode...`);
      result = await agent.invoke({
        messages: messages
      }, {
        recursionLimit: 100
      });
      console.log(`🧠 [DEEP-AGENT] Invoke completed successfully`);
    }
    
    console.log(`🧠 [DEEP-AGENT] Workflow completed. Result structure:`, {
      hasMessages: !!result.messages,
      messageCount: result.messages?.length || 0,
      lastMessageType: result.messages?.[result.messages.length - 1]?.type,
      hasContent: !!result.messages?.[result.messages.length - 1]?.content
    });
    
    // Enhanced logging for debugging response extraction
    if (result.messages && result.messages.length > 0) {
      console.log(`🧠 [DEEP-AGENT] Detailed message analysis:`);
      result.messages.forEach((msg: any, i: number) => {
        const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
        const hasToolCallId = msg.tool_call_id || msg.lc_direct_tool_output;
        const hasName = !!msg.name;
        const contentLength = msg.content?.length || 0;
        const contentType = typeof msg.content;
        const contentPreview = contentType === 'string' ? msg.content.substring(0, 150) : `[${contentType}]`;
        
        console.log(`🔍 [${i}] ${hasToolCalls ? 'TOOL-CALL' : hasToolCallId ? 'TOOL-RESULT' : hasName ? 'FUNCTION' : 'ASSISTANT'} (${contentLength} chars): ${contentPreview}...`);
        
        // Log any large content that might be getting filtered out
        if (contentLength > 1000 && (hasToolCallId || hasName)) {
          console.log(`🔍 [${i}] LARGE FILTERED CONTENT: This message has ${contentLength} chars but is being filtered out`);
        }
      });
    }
    
    // Extract response from agent result - improved logic to capture full content
    let response = 'I apologize, but I encountered an issue processing your request.';
    
    if (result.messages && result.messages.length > 0) {
      // Find assistant messages with balanced filtering (exclude tool noise, include substantial responses)
      const assistantMessages = result.messages.filter((msg: any) => {
        // Skip tool calls
        if (msg.tool_calls && msg.tool_calls.length > 0) return false;
        
        // Skip tool results and function messages (the noise)
        if (msg.tool_call_id || msg.lc_direct_tool_output || msg.name) return false;
        
        // Only include messages with substantial content (likely final responses)
        const hasContent = msg.content && msg.content.length > 500;
        
        if (hasContent) {
          console.log(`🔍 [INCLUSION] Including substantial assistant message with ${msg.content.length} chars`);
          return true;
        }
        
        return false;
      });
      
      console.log(`🧠 [DEEP-AGENT] Found ${assistantMessages.length} potential response messages out of ${result.messages.length} total`);
      
      if (assistantMessages.length > 0) {
        // Extract content from potential response messages
        const contentParts = assistantMessages.map((msg: any) => {
          if (typeof msg.content === 'string') {
            return msg.content;
          } else if (Array.isArray(msg.content)) {
            // Handle structured content (find text content)
            const textContent = msg.content.find((c: any) => c.type === 'text');
            return textContent?.text || '';
          }
          return '';
        }).filter((content: string) => content.length > 0);
        
        if (contentParts.length > 0) {
          // Combine all content parts with double newlines for readability
          response = contentParts.join('\n\n');
          console.log(`✅ [DEEP-AGENT] Combined ${contentParts.length} content parts (${response.length} chars total)`);
        } else {
          // Fallback to last message content
          const lastMsg = result.messages[result.messages.length - 1];
          response = lastMsg.content || response;
          console.log(`⚠️ [DEEP-AGENT] No content parts found, using last message (${response.length} chars)`);
        }
      } else {
        // Fallback to last message if no potential response messages found
        const lastMsg = result.messages[result.messages.length - 1];
        response = lastMsg.content || response;
        console.log(`⚠️ [DEEP-AGENT] No potential response messages found, using last message (${response.length} chars)`);
      }
    }
    
    console.log(`✅ [DEEP-AGENT] Final response extracted (${typeof response}, ${response?.length || 0} chars)`);
    
    return {
      claudeResponse: response
    };
    
  } catch (error) {
    console.error('❌ Deep agent call failed:', error);
    return {
      error: `Deep agent processing failed: ${error instanceof Error ? error.message : String(error)}`,
      errorOccurred: true
    };
  }
};

// Binah workflow nodes (using deep agent instead of regular Claude call)
const binahNodes: WorkflowNodes = {
  validateMessageNode,
  sendAcknowledgmentNode,
  fetchContextNode,
  callClaudeNode: callDeepAgentNode, // Replace with deep agent
  validateSlackFormattingNode,
  formatResponseNode,
  sendResponseNode,
  handleErrorNode
};

export function createBinahWorkflow() {
  console.log('🧠 Creating Binah deep research workflow...');
  return createBaseWorkflow(binahNodes);
}

// Cleanup function for graceful shutdown
export async function cleanupBinahWorkflow() {
  if (mcpClient) {
    console.log('🧹 Cleaning up Binah MCP client...');
    try {
      // Note: Check if close method exists on the client
      if (typeof mcpClient.close === 'function') {
        await mcpClient.close();
      }
      mcpClient = null;
      binahAgent = null;
      console.log('✅ Binah workflow cleanup completed');
    } catch (error) {
      console.error('⚠️ Error during Binah cleanup:', error);
    }
  }
}