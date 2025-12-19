import { createBaseWorkflow, WorkflowNodes } from './workflow-base';
import {
  validateMessageNode,
  sendAcknowledgmentNode,
  fetchContextNode,
  callClaudeNode,
  validateSlackFormattingNode,
  formatResponseNode,
  sendResponseNode,
  handleErrorNode,
  initializeServices
} from '../nodes';
import { SlackWorkflowState } from '../graph-types';
import { traced } from 'braintrust';
import { initializeBraintrust } from '../braintrust-logger';

// Bina workflow nodes (using shared Claude service with Braintrust tracing)
const binaNodes: WorkflowNodes = {
  validateMessageNode,
  sendAcknowledgmentNode,
  fetchContextNode,
  callClaudeNode, // Uses shared ClaudeServiceImpl (now Braintrust-traced)
  validateSlackFormattingNode,
  formatResponseNode,
  sendResponseNode,
  handleErrorNode
};

export function createBinaWorkflow(slackToken?: string, anthropicKey?: string, mcpUrl?: string) {
  console.log('🤖 Creating Bina workflow with Braintrust observability...');

  // Initialize Braintrust logger
  initializeBraintrust();

  // Initialize services for this specific workflow instance if parameters provided
  if (slackToken && anthropicKey && mcpUrl) {
    // Initialize shared services for Slack operations (now uses Braintrust-traced client)
    initializeServices(slackToken, anthropicKey, mcpUrl);
    console.log('🔧 Bina workflow services initialized with bot-specific tokens');
  }

  const baseWorkflow = createBaseWorkflow(binaNodes);

  // Return a traced wrapper that captures the entire workflow execution
  return {
    invoke: async (initialState: SlackWorkflowState) => {
      return traced(
        async (span) => {
          const event = initialState.slackEvent;

          console.log('🤖 [BINA-TRACE] Starting traced workflow execution...');
          
          // Execute the actual workflow
          const result = await baseWorkflow.invoke(initialState);
          
          // Extract the cleaned user query from conversationContext
          const userQuery = result.conversationContext?.find((msg: any) => msg.role === 'user')?.content || event.text || '';
          
          // Log input and output
          span.log({
            input: userQuery,
            output: result.formattedResponse || result.claudeResponse || null,
            metadata: {
              bot: 'bina',
              user: event.user,
              channel: event.channel,
              thread_ts: event.thread_ts || event.ts,
              message_ts: event.ts,
              shouldProcess: result.shouldProcess,
              errorOccurred: result.errorOccurred,
              error: result.error,
            },
          });

          console.log('🤖 [BINA-TRACE] Traced workflow execution completed');
          
          return result;
        },
        {
          name: 'bina-slack-workflow',
        }
      );
    },
  };
}

// Cleanup function for graceful shutdown
export async function cleanupBinaWorkflow(): Promise<void> {
  console.log('🧹 Bina workflow cleanup completed');
}
