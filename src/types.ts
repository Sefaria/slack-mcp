// Slack Types
export interface SlackMessageEvent {
  type: string;
  user?: string;
  text?: string;
  ts: string;
  channel: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
  message?: {
    user?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface SlackMessage {
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
}

// Conversation Types
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Configuration Types
export interface Config {
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET: string;
  ANTHROPIC_API_KEY: string;
  SEFARIA_MCP_URL: string;
  PORT: number;
}

// MCP Types
export interface MCPServerConfig {
  name: string;
  uri: string;
}

// Service Interfaces
export interface SlackHandler {
  handleMessage(event: SlackMessageEvent): Promise<void>;
}

export interface ClaudeService {
  sendMessage(messages: ConversationMessage[], mcpServerUrl: string): Promise<string>;
}