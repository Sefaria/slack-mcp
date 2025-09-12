import { createBaseWorkflow, WorkflowNodes } from './workflow-base';
import {
  validateMessageNode,
  sendAcknowledgmentNode,
  fetchContextNode,
  callClaudeNode,
  validateSlackFormattingNode,
  formatResponseNode,
  sendResponseNode,
  handleErrorNode
} from '../nodes';

// Bina-specific workflow nodes (currently uses the default implementations)
const binaNodes: WorkflowNodes = {
  validateMessageNode,
  sendAcknowledgmentNode,
  fetchContextNode,
  callClaudeNode,
  validateSlackFormattingNode,
  formatResponseNode,
  sendResponseNode,
  handleErrorNode
};

export function createBinaWorkflow(slackToken?: string, anthropicKey?: string, mcpUrl?: string) {
  console.log('🤖 Creating Bina workflow...');
  
  // Initialize services for this specific workflow instance if parameters provided
  if (slackToken && anthropicKey && mcpUrl) {
    const { initializeServices } = require('../nodes');
    initializeServices(slackToken, anthropicKey, mcpUrl);
    console.log('🔧 Bina workflow services initialized with bot-specific tokens');
  }
  
  return createBaseWorkflow(binaNodes);
}