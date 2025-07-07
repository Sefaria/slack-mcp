import { StateGraph, Annotation } from '@langchain/langgraph';
import { SlackWorkflowState, SlackWorkflowNode } from './graph-types';
import { SlackMessageEvent } from './types';

// Define the state annotation for LangGraph
const SlackStateAnnotation = Annotation.Root({
  slackEvent: Annotation<SlackMessageEvent>,
  shouldProcess: Annotation<boolean>,
  acknowledgmentSent: Annotation<boolean>,
  threadHistory: Annotation<any[]>,
  conversationContext: Annotation<any[]>,
  messageText: Annotation<string | null>,
  claudeResponse: Annotation<string | null>,
  needsSlackFormatting: Annotation<boolean>,
  slackValidatedResponse: Annotation<string | null>,
  formattedResponse: Annotation<string | null>,
  error: Annotation<string | null>,
  errorOccurred: Annotation<boolean>
});

// Import node implementations (will be created next)
import {
  validateMessageNode,
  sendAcknowledgmentNode,
  fetchContextNode,
  callClaudeNode,
  validateSlackFormattingNode,
  formatResponseNode,
  sendResponseNode,
  handleErrorNode
} from './nodes';

export function createSlackWorkflow() {
  const workflow = new StateGraph(SlackStateAnnotation)
    // Add all nodes
    .addNode('validate', validateMessageNode)
    .addNode('acknowledge', sendAcknowledgmentNode)
    .addNode('fetchContext', fetchContextNode)
    .addNode('callClaude', callClaudeNode)
    .addNode('validateSlackFormatting', validateSlackFormattingNode)
    .addNode('formatResponse', formatResponseNode)
    .addNode('sendResponse', sendResponseNode)
    .addNode('handleError', handleErrorNode)
    
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