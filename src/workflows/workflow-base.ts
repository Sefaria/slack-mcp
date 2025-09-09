import { StateGraph, Annotation } from '@langchain/langgraph';
import { SlackWorkflowState, SlackWorkflowNode } from '../graph-types';
import { SlackMessageEvent } from '../types';

// Define the state annotation for LangGraph - shared across all bots
export const SlackStateAnnotation = Annotation.Root({
  slackEvent: Annotation<SlackMessageEvent>,
  shouldProcess: Annotation<boolean>,
  acknowledgmentSent: Annotation<boolean>,
  threadHistory: Annotation<any[]>,
  conversationContext: Annotation<any[]>,
  messageText: Annotation<string | null>,
  botContext: Annotation<{ name: string; userId: string | undefined } | undefined>,
  claudeResponse: Annotation<string | null>,
  needsSlackFormatting: Annotation<boolean>,
  slackValidatedResponse: Annotation<string | null>,
  formattedResponse: Annotation<string | null>,
  error: Annotation<string | null>,
  errorOccurred: Annotation<boolean>
});

export interface WorkflowNodes {
  validateMessageNode: (state: SlackWorkflowState) => Promise<Partial<SlackWorkflowState>>;
  sendAcknowledgmentNode: (state: SlackWorkflowState) => Promise<Partial<SlackWorkflowState>>;
  fetchContextNode: (state: SlackWorkflowState) => Promise<Partial<SlackWorkflowState>>;
  callClaudeNode: (state: SlackWorkflowState) => Promise<Partial<SlackWorkflowState>>;
  validateSlackFormattingNode: (state: SlackWorkflowState) => Promise<Partial<SlackWorkflowState>>;
  formatResponseNode: (state: SlackWorkflowState) => Promise<Partial<SlackWorkflowState>>;
  sendResponseNode: (state: SlackWorkflowState) => Promise<Partial<SlackWorkflowState>>;
  handleErrorNode: (state: SlackWorkflowState) => Promise<Partial<SlackWorkflowState>>;
}

export function createBaseWorkflow(nodes: WorkflowNodes) {
  const workflow = new StateGraph(SlackStateAnnotation)
    // Add all nodes
    .addNode('validate', nodes.validateMessageNode)
    .addNode('acknowledge', nodes.sendAcknowledgmentNode)
    .addNode('fetchContext', nodes.fetchContextNode)
    .addNode('callClaude', nodes.callClaudeNode)
    .addNode('validateSlackFormatting', nodes.validateSlackFormattingNode)
    .addNode('formatResponse', nodes.formatResponseNode)
    .addNode('sendResponse', nodes.sendResponseNode)
    .addNode('handleError', nodes.handleErrorNode)
    
    // Define the flow
    .setEntryPoint('validate')
    
    // Conditional routing from validate
    .addConditionalEdges(
      'validate',
      (state) => {
        if (state.errorOccurred) return 'handleError';
        if (!state.shouldProcess) return '__end__';
        return 'acknowledge';
      }
    )
    
    .addEdge('acknowledge', 'fetchContext')
    .addEdge('fetchContext', 'callClaude')
    
    // Conditional routing from Claude
    .addConditionalEdges(
      'callClaude',
      (state) => {
        if (state.errorOccurred) return 'handleError';
        return 'validateSlackFormatting';
      }
    )
    
    // Conditional routing from Slack formatting validation
    .addConditionalEdges(
      'validateSlackFormatting',
      (state) => {
        if (state.errorOccurred) return 'handleError';
        return 'formatResponse';
      }
    )
    
    .addEdge('formatResponse', 'sendResponse')
    .addEdge('sendResponse', '__end__')
    .addEdge('handleError', '__end__');

  return workflow.compile();
}