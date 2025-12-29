import { createBaseWorkflow, WorkflowNodes } from './workflow-base';
import {
  validateMessageNode,
  sendAcknowledgmentNode,
  fetchContextNode,
  validateSlackFormattingNode,
  formatResponseNode,
  sendResponseNode,
  handleErrorNode,
  initializeServices,
  getMessageText,
  postAgentProgress
} from '../nodes';
import { SlackWorkflowState } from '../graph-types';
import { AgentClaudeService, AgentProgressUpdate } from '../agent/agent-claude-service';
import { traced, Span } from 'braintrust';
import { SlackMessageEvent } from '../types';

let agentClaudeService: AgentClaudeService | null = null;

function progressEnabled(): boolean {
  const raw = (process.env.SLACK_STREAM_AGENT_PROGRESS || 'true').toLowerCase().trim();
  return raw !== '0' && raw !== 'false' && raw !== 'off' && raw !== 'no';
}

function progressVerbose(): boolean {
  const raw = (process.env.SLACK_STREAM_AGENT_PROGRESS_VERBOSE || 'false').toLowerCase().trim();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

function ensureAgentClaudeService(apiKey?: string): AgentClaudeService {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('Missing ANTHROPIC_API_KEY');
  }
  if (!agentClaudeService) {
    agentClaudeService = new AgentClaudeService(key);
  }
  return agentClaudeService;
}

async function callClaudeAgentNode(state: SlackWorkflowState): Promise<Partial<SlackWorkflowState>> {
  try {
    const service = ensureAgentClaudeService();
    const shouldStreamProgress = progressEnabled();
    const shouldIncludeToolOutput = progressVerbose();
    const onProgress = shouldStreamProgress
      ? (update: AgentProgressUpdate) => {
          if (update.type === 'status') {
            void postAgentProgress(state.slackEvent, update.text);
            return;
          }
          if (update.type === 'tool_start') {
            void postAgentProgress(state.slackEvent, update.description);
            return;
          }
          if (update.type === 'tool_end') {
            if (update.isError) {
              const suffix = update.outputPreview ? `: ${update.outputPreview}` : '';
              void postAgentProgress(state.slackEvent, `Tool \`${update.toolName}\` failed${suffix}`);
            } else {
              void postAgentProgress(state.slackEvent, `Finished tool \`${update.toolName}\``);
              if (shouldIncludeToolOutput && update.outputPreview) {
                void postAgentProgress(state.slackEvent, `Tool output (preview): ${update.outputPreview}`);
              }
            }
          }
        }
      : undefined;

    const response = await service.sendMessage(state.conversationContext || [], { onProgress });
    return { claudeResponse: response };
  } catch (error) {
    return {
      errorOccurred: true,
      error: `Claude Agent service failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

const agentNodes: WorkflowNodes = {
  validateMessageNode,
  sendAcknowledgmentNode,
  fetchContextNode,
  callClaudeNode: callClaudeAgentNode,
  validateSlackFormattingNode,
  formatResponseNode,
  sendResponseNode,
  handleErrorNode
};

function shouldTraceMessage(event: SlackMessageEvent, botUserId?: string): boolean {
  if (event.bot_id) return false;
  if (event.subtype && event.subtype !== 'bot_message') return false;

  const messageText = getMessageText(event);
  if (!messageText) return false;

  const mentions = messageText.match(/<@(U[A-Z0-9]+)>/g);
  if (!mentions || mentions.length === 0) return false;

  if (botUserId && !messageText.includes(`<@${botUserId}>`)) return false;
  return true;
}

export function createAgentApiWorkflow(slackToken?: string, anthropicKey?: string, mcpUrl?: string) {
  console.log('🤖 Creating AgentAPI workflow (internal tools, no remote MCP calls)...');

  // Initialize shared Slack services from existing code. This also initializes MCP Claude service,
  // but this workflow uses AgentClaudeService for the actual model call.
  if (slackToken && anthropicKey && mcpUrl) {
    initializeServices(slackToken, anthropicKey, mcpUrl);
    agentClaudeService = new AgentClaudeService(anthropicKey);
  } else if (anthropicKey) {
    agentClaudeService = new AgentClaudeService(anthropicKey);
  }

  const baseWorkflow = createBaseWorkflow(agentNodes);

  return {
    invoke: async (initialState: SlackWorkflowState) => {
      const event = initialState.slackEvent;
      const botUserId = initialState.botContext?.userId;

      if (!shouldTraceMessage(event, botUserId)) {
        return baseWorkflow.invoke(initialState);
      }

      return traced(
        async (span: Span) => {
          const result = await baseWorkflow.invoke(initialState);

          if (!result.shouldProcess) {
            return result;
          }

          const userQuery =
            result.conversationContext?.find((msg: any) => msg.role === 'user')?.content ||
            getMessageText(event) ||
            '';

          span.log({
            input: userQuery,
            output: result.formattedResponse || result.claudeResponse || null,
            ...(result.errorOccurred && result.error ? { error: result.error } : {}),
            tags: ['AgentAPI'],
            metadata: {
              bot: initialState.botContext?.name || 'agentapi',
              user: event.user,
              channel: event.channel,
              thread_ts: event.thread_ts || event.ts,
              message_ts: event.ts,
              shouldProcess: result.shouldProcess,
              errorOccurred: result.errorOccurred
            },
            metrics: {
              ...(result.errorOccurred ? { errors: 1 } : {})
            }
          });

          return result;
        },
        { name: 'agentapi-slack-workflow' }
      );
    }
  };
}
