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
  initializeServices,
  getMessageText
} from '../nodes';
import { SlackWorkflowState } from '../graph-types';
import { SlackMessageEvent } from '../types';
import { traced } from 'braintrust';
import { initializeBraintrust } from '../braintrust-logger';

/**
 * Quick pre-validation to determine if we should trace this message.
 * This mirrors the essential checks in validateMessageNode but runs before
 * entering the traced context, so we can skip logging for messages we won't process.
 */
function shouldTraceMessage(event: SlackMessageEvent, botUserId?: string): boolean {
  // Skip bot messages
  if (event.bot_id) {
    console.log('🤖 [BINA-PRECHECK] Skipping bot message');
    return false;
  }
  
  // Skip messages with certain subtypes
  if (event.subtype && event.subtype !== 'bot_message') {
    console.log('🤖 [BINA-PRECHECK] Skipping subtype:', event.subtype);
    return false;
  }
  
  // Must have message text
  const messageText = getMessageText(event);
  if (!messageText) {
    console.log('🤖 [BINA-PRECHECK] No message text');
    return false;
  }
  
  // Must have bot mentions
  const mentions = messageText.match(/<@(U[A-Z0-9]+)>/g);
  if (!mentions || mentions.length === 0) {
    console.log('🤖 [BINA-PRECHECK] No bot mentions found');
    return false;
  }
  
  // If we have a bot user ID, check if this bot is mentioned
  if (botUserId && !messageText.includes(`<@${botUserId}>`)) {
    console.log('🤖 [BINA-PRECHECK] This bot not mentioned');
    return false;
  }
  
  console.log('🤖 [BINA-PRECHECK] Message should be traced');
  return true;
}

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

  // Return a wrapper that only traces when we should process the message
  return {
    invoke: async (initialState: SlackWorkflowState) => {
      const event = initialState.slackEvent;
      const botUserId = initialState.botContext?.userId;
      
      // Quick pre-check: should we trace this message?
      if (!shouldTraceMessage(event, botUserId)) {
        console.log('🤖 [BINA] Skipping trace for message that won\'t be processed');
        // Run workflow without tracing - it will exit quickly after validation
        return await baseWorkflow.invoke(initialState);
      }
      
      // Message should be processed - wrap in traced() for Braintrust observability
      return traced(
        async (span: { log: (data: Record<string, unknown>) => void }) => {
          console.log('🤖 [BINA-TRACE] Starting traced workflow execution...');
          
          // Execute the actual workflow
          const result = await baseWorkflow.invoke(initialState);
          
          // Double-check: only log if we actually processed (in case validation found more issues)
          if (!result.shouldProcess) {
            console.log('🤖 [BINA-TRACE] Workflow determined not to process, skipping log');
            return result;
          }
          
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
