import { createBaseWorkflow, WorkflowNodes } from './workflow-base';
import {
  validateMessageNode,
  sendAcknowledgmentNode,
  fetchContextNode,
  validateSlackFormattingNode,
  formatResponseNode,
  sendResponseNode,
  handleErrorNode,
  initializeServices
} from '../nodes';
import { SlackWorkflowState } from '../graph-types';
import { BraintrustClaudeService } from '../braintrust-claude-service';
import { traced, initLogger } from 'braintrust';

// Beta's Claude service instance with Braintrust observability and prompt versioning
let betaClaudeService: BraintrustClaudeService | null = null;
let braintrustInitialized = false;

function initializeBetaServices(anthropicKey: string, mcpUrl: string) {
  // Initialize Braintrust logger once for the project
  if (!braintrustInitialized) {
    initLogger({
      projectName: 'On Site Agent',
      apiKey: process.env.BRAINTRUST_API_KEY,
    });
    braintrustInitialized = true;
    console.log('🧠 Beta Braintrust logger initialized');
  }

  betaClaudeService = new BraintrustClaudeService(
    anthropicKey,
    mcpUrl,
    'On Site Agent' // Braintrust project name
  );
  console.log('🧠 Beta Braintrust Claude service initialized');
}

// Beta-specific Claude call node using Braintrust service
async function callBetaClaudeNode(state: SlackWorkflowState): Promise<Partial<SlackWorkflowState>> {
  try {
    console.log('🧠 [BETA-CLAUDE] Starting Braintrust-traced Claude API call...');
    console.log('🧠 [BETA-CLAUDE] Conversation context length:', state.conversationContext?.length || 0);

    if (!betaClaudeService) {
      console.error('🧠 [BETA-CLAUDE] ERROR: Beta services not initialized');
      return {
        errorOccurred: true,
        error: 'Beta services not initialized'
      };
    }

    if (!state.conversationContext || state.conversationContext.length === 0) {
      console.warn('🧠 [BETA-CLAUDE] WARNING: No conversation context provided');
    }

    console.log('📤 [BETA-CLAUDE] Sending request to Braintrust Claude service...');
    const response = await betaClaudeService.sendMessage(state.conversationContext || []);

    console.log('📥 [BETA-CLAUDE] Response received:', response.length, 'chars');

    if (!response || response.trim().length === 0) {
      console.error('🧠 [BETA-CLAUDE] ERROR: Empty response from Claude');
      return {
        errorOccurred: true,
        error: 'Claude returned empty response'
      };
    }

    console.log('🧠 [BETA-CLAUDE] Claude call completed successfully');
    return {
      claudeResponse: response
    };
  } catch (error) {
    console.error('❌ [BETA-CLAUDE] Claude service error:', error);
    console.error('❌ [BETA-CLAUDE] Error message:', error instanceof Error ? error.message : String(error));

    return {
      errorOccurred: true,
      error: `Claude service failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Beta-specific workflow nodes (using Braintrust Claude service)
const betaNodes: WorkflowNodes = {
  validateMessageNode,
  sendAcknowledgmentNode,
  fetchContextNode,
  callClaudeNode: callBetaClaudeNode, // Use Beta's Braintrust Claude node
  validateSlackFormattingNode,
  formatResponseNode,
  sendResponseNode,
  handleErrorNode
};

export function createBetaWorkflow(slackToken?: string, anthropicKey?: string, mcpUrl?: string) {
  console.log('🧠 Creating Beta workflow with Braintrust observability...');

  // Initialize services for this specific workflow instance
  if (slackToken && anthropicKey && mcpUrl) {
    // Initialize shared services for Slack operations
    initializeServices(slackToken, anthropicKey, mcpUrl);
    // Initialize Beta-specific traced Claude service
    initializeBetaServices(anthropicKey, mcpUrl);
    console.log('🔧 Beta workflow services initialized with bot-specific tokens');
  }

  const baseWorkflow = createBaseWorkflow(betaNodes);

  // Return a traced wrapper that captures the entire workflow execution
  return {
    invoke: async (initialState: SlackWorkflowState) => {
      return traced(
        async (span: { log: (data: Record<string, unknown>) => void }) => {
          const event = initialState.slackEvent;

          console.log('🧠 [BETA-TRACE] Starting traced workflow execution...');
          
          // Execute the actual workflow
          const result = await baseWorkflow.invoke(initialState);
          
          // Extract the cleaned user query from conversationContext (same text sent to Claude)
          const userQuery = result.conversationContext?.find((msg: any) => msg.role === 'user')?.content || event.text || '';
          
          // Log input and output together after workflow completes
          span.log({
            input: userQuery,
            output: result.formattedResponse || result.claudeResponse || null,
            metadata: {
              bot: 'beta',
              user: event.user,
              channel: event.channel,
              thread_ts: event.thread_ts || event.ts,
              message_ts: event.ts,
              shouldProcess: result.shouldProcess,
              errorOccurred: result.errorOccurred,
              error: result.error,
            },
          });

          console.log('🧠 [BETA-TRACE] Traced workflow execution completed');
          
          return result;
        },
        {
          name: 'beta-slack-workflow',
        }
      );
    },
  };
}

// Cleanup function for graceful shutdown
export async function cleanupBetaWorkflow(): Promise<void> {
  if (betaClaudeService) {
    await betaClaudeService.cleanup();
    betaClaudeService = null;
    console.log('🧹 Beta workflow cleanup completed');
  }
}
