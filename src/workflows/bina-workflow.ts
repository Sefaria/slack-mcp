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

export function createBinaWorkflow() {
  console.log('🤖 Creating Bina workflow...');
  return createBaseWorkflow(binaNodes);
}