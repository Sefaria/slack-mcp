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
  
  // Claude integration
  claudeResponse: string | null;
  
  // Response formatting
  formattedResponse: string | null;
  
  // Error handling
  error: string | null;
  errorOccurred: boolean;
}

// LangGraph Node Function Type
export type SlackWorkflowNode = (state: SlackWorkflowState) => Promise<Partial<SlackWorkflowState>>;