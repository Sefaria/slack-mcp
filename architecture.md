# MVP Software Architecture

## Project Structure
```
slack-mcp/
├── src/
│   ├── app.ts              # Main Express server + initialization
│   ├── slack-handler.ts    # Slack message event processing
│   ├── claude-service.ts   # Claude API + MCP integration
│   └── types.ts           # TypeScript type definitions
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Core Files

### 1. Main Application (`src/app.ts`)
```typescript
class SlackMCPApp {
  private app: Express;
  private slackHandler: SlackHandler;

  constructor();
  async initialize(): Promise<void>;
  async start(port: number): Promise<void>;
  private setupRoutes(): void;
}

// Environment configuration
interface Config {
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET: string;
  ANTHROPIC_API_KEY: string;
  SEFARIA_MCP_URL: string;
  PORT: number;
}
```

### 2. Slack Handler (`src/slack-handler.ts`)
```typescript
interface SlackHandler {
  handleMessage(event: SlackMessageEvent): Promise<void>;
}

class SlackHandlerImpl implements SlackHandler {
  private slackClient: WebClient;
  private claudeService: ClaudeService;
  private botUserId: string;

  constructor(slackToken: string, claudeService: ClaudeService);
  async handleMessage(event: SlackMessageEvent): Promise<void>;
  private shouldProcessMessage(event: SlackMessageEvent): boolean;
  private async getThreadHistory(channel: string, threadTs: string): Promise<SlackMessage[]>;
  private buildConversationContext(messages: SlackMessage[]): ConversationMessage[];
  private isAppMentioned(text: string): boolean;
}
```

### 3. Claude Service (`src/claude-service.ts`)
```typescript
interface ClaudeService {
  sendMessage(messages: ConversationMessage[], mcpServerUrl: string): Promise<string>;
}

class ClaudeServiceImpl implements ClaudeService {
  private client: Anthropic;
  private mcpServerUrl: string;

  constructor(apiKey: string, mcpServerUrl: string);
  async sendMessage(messages: ConversationMessage[], mcpServerUrl: string): Promise<string>;
  private buildMCPConfig(): MCPServerConfig;
}

interface MCPServerConfig {
  name: string;
  uri: string;
}
```

### 4. Type Definitions (`src/types.ts`)
```typescript
// Slack Types
interface SlackMessageEvent {
  type: string;
  user: string;
  text: string;
  ts: string;
  channel: string;
  thread_ts?: string;
  bot_id?: string;
}

interface SlackMessage {
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
}

// Conversation Types
interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}
```

## API Endpoints
```typescript
POST /slack/events    # Slack Events API webhook
GET  /health         # Basic health check
```

## Key Simplifications from Full Architecture

### Removed Components
- ❌ Command handlers and slash commands
- ❌ Configuration service (using env vars)
- ❌ Per-workspace settings
- ❌ Advanced error handling classes
- ❌ Retry utilities
- ❌ Logging utilities
- ❌ Message formatters
- ❌ Thread parsing utilities
- ❌ Validation middleware
- ❌ Multiple message modes

### MVP Assumptions
- **Single message mode**: Mention-only
- **Global configuration**: Environment variables
- **Basic error handling**: Try/catch blocks
- **Simple context**: Last 10 messages max
- **No validation**: Trust Slack webhook format
- **Console logging**: No structured logging
- **Hardcoded limits**: 10 messages, 4000 tokens

## Environment Variables
```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
ANTHROPIC_API_KEY=your-anthropic-key
SEFARIA_MCP_URL=https://e32b-2a06-c701-99c6-7700-45b-40c9-5df6-e499.ngrok-free.app
PORT=3000
```

## Deferred Architecture Components
All advanced features from the original 18-file architecture are deferred:
- Multi-mode message processing
- Per-workspace configuration system
- Advanced error handling hierarchy
- Retry logic with exponential backoff
- Request signature verification
- Token-aware context management
- Structured logging system
- Health monitoring
- Input validation
- Message formatting utilities