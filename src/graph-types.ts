import { SlackMessageEvent, SlackMessage, ConversationMessage } from './types';

// LangGraph State Interface
export interface SlackWorkflowState {
  // Input
  slackEvent: SlackMessageEvent;
  
  // Processing flags
  shouldProcess: boolean;
  acknowledgmentSent: boolean;
  
  // Context
  threadHistory: SlackMessage[];
  conversationContext: ConversationMessage[];
  messageText: string | null;
  
  // Bot context for validation
  botContext?: {
    name: string;
    userId: string | undefined;
  };
  
  // Claude integration
  claudeResponse: string | null;
  
  // Slack formatting validation
  needsSlackFormatting: boolean;
  slackValidatedResponse: string | null;
  
  // Response formatting
  formattedResponse: string | null;
  
  // Error handling
  error: string | null;
  errorOccurred: boolean;
}

// LangGraph Node Function Type
export type SlackWorkflowNode = (state: SlackWorkflowState) => Promise<Partial<SlackWorkflowState>>;