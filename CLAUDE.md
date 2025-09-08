# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a multi-bot Slack platform that integrates Claude LLM with Sefaria's Jewish text database through MCP (Model Context Protocol). The platform hosts multiple specialized bots that respond to mentions in Slack channels and provide scholarly responses about Jewish texts using Claude's API with MCP server access.

### Multi-Bot Architecture
The platform supports multiple bots with different personalities and specializations:
- **Bina** (בינה) - Main scholarly assistant for general Jewish text inquiries
- **Binah** (בינה) - Deep research variant for comprehensive analysis (planned)
- Each bot has its own Slack webhook endpoint but shares common infrastructure (Claude API, MCP connector)

## Development Commands

```bash
# Development (with hot reload)
npm run dev

# Build TypeScript to JavaScript
npm run build

# Run built application
npm start

# Install dependencies
npm install
```

## Core Architecture

### LangGraph Workflow Engine
The application uses **LangGraph** for orchestrating message processing through an 8-node workflow:

**Input**: Slack message event → **LangGraph workflow** → **Output**: Formatted Slack response

#### Workflow Nodes (Sequential):
1. **validate** - Validates message, checks mentions, determines processing need
2. **acknowledge** - Sends contextual emoji reaction (🤔, 👀, 🙏, 📜, 📚)
3. **fetchContext** - Retrieves thread history, builds conversation context
4. **callClaude** - Calls Claude API with MCP integration for Sefaria access
5. **validateSlackFormatting** - Checks if response needs formatting fixes
6. **formatResponse** - Applies final formatting, coverage warnings
7. **sendResponse** - Posts formatted response to Slack
8. **handleError** - Handles any errors during processing

#### Key LangGraph Files:
- **`src/workflows/workflow-base.ts`** - Base workflow template shared by all bots
- **`src/workflows/bina-workflow.ts`** - Bina bot-specific workflow implementation
- **`src/workflow.ts`** - Legacy file (deprecated, kept for backward compatibility)
- **`src/nodes.ts`** - Implementation of all 8 workflow nodes
- **`src/graph-types.ts`** - TypeScript interfaces for workflow state

#### State Management:
The workflow uses `SlackWorkflowState` to track:
- `slackEvent` - Input Slack message event
- `shouldProcess` - Processing decision flag
- `acknowledgmentSent` - Emoji reaction status
- `threadHistory` - Slack conversation context
- `conversationContext` - Claude API conversation format
- `claudeResponse` - Raw Claude API response
- `needsSlackFormatting` - Formatting requirement flag
- `slackValidatedResponse` - Formatted response for Slack
- `formattedResponse` - Final cleaned response
- `error` and `errorOccurred` - Error handling state

### Multi-Bot Core Components

1. **`src/app.ts`** - Express server with dynamic multi-bot routing and LangGraph workflow initialization
2. **`src/bot-registry.ts`** - Bot discovery, registration, and management system
3. **`src/workflows/`** - Directory containing bot-specific workflow implementations
4. **`src/slack-handler.ts`** - Fallback message processing (legacy compatibility, used when LangGraph workflow fails)
5. **`src/claude-service.ts`** - Shared Claude API integration with MCP connector
6. **`src/types.ts`** - TypeScript interfaces for all components

### Key Dependencies
- **Express v4.21.2** (v5 has TypeScript compatibility issues)
- **@slack/web-api** for Slack integration
- **@anthropic-ai/sdk** for Claude API
- **@langchain/langgraph** for workflow orchestration
- **@langchain/core** for LangGraph annotations and utilities
- **MCP Integration** via Claude Messages API with `anthropic-beta: mcp-client-2025-04-04` header

### Multi-Bot API Endpoints
- `POST /slack/events` - Default webhook (routes to "bina" for backward compatibility)
- `POST /slack/events/:botName` - Bot-specific webhook endpoints
  - `POST /slack/events/bina` - Bina bot endpoint
  - `POST /slack/events/binah` - Binah bot endpoint (when configured)
- `GET /health` - Health check endpoint with bot registry status

## Multi-Bot Configuration

### Environment Variable Patterns

#### Option 1: Multi-Bot Configuration (Recommended)
```bash
# Shared configuration (required for all bots)
ANTHROPIC_API_KEY=your-anthropic-key
SEFARIA_MCP_URL=https://your-ngrok-url.ngrok-free.app
PORT=3001

# Bot-specific configurations (pattern: BOTNAME_SLACK_TOKEN, BOTNAME_SIGNING_SECRET)
BINA_SLACK_TOKEN=xoxb-your-bina-bot-token
BINA_SIGNING_SECRET=your-bina-signing-secret

BINAH_SLACK_TOKEN=xoxb-your-binah-bot-token
BINAH_SIGNING_SECRET=your-binah-signing-secret
```

#### Option 2: Legacy Single-Bot Configuration (Backward Compatibility)
```bash
# This configuration will be automatically registered as the "bina" bot
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
ANTHROPIC_API_KEY=your-anthropic-key
SEFARIA_MCP_URL=https://your-ngrok-url.ngrok-free.app
PORT=3001
```

### Bot Discovery and Registration
The system automatically discovers bots based on environment variable patterns:
1. **Auto-discovery**: Scans for `BOTNAME_SLACK_TOKEN` environment variables
2. **Auto-registration**: Registers found bots in the bot registry
3. **Workflow assignment**: Maps bots to their specific workflow implementations
4. **Route creation**: Creates dynamic routes for each registered bot

### Adding New Bots
To add a new bot (no code changes required):
1. Add `NEWBOT_SLACK_TOKEN` and `NEWBOT_SIGNING_SECRET` environment variables
2. Optionally create `src/workflows/newbot-workflow.ts` for custom behavior
3. Configure Slack webhook URL: `https://your-domain.com/slack/events/newbot`
4. Restart the application - the bot will be automatically discovered and registered

### Slack App Configuration
Required OAuth scopes:
- `channels:read`
- `channels:history`
- `groups:read`
- `groups:history`
- `im:read`
- `im:history`
- `im:write`
- `mpim:read`
- `mpim-write`
- `mpim:history`
- `chat:write`
- `app_mentions:read`
- `reactions:write`

Event subscriptions needed for: `message.channels`, `message.groups`, `message.im`, `message.mpim`

## Technical Implementation Details

### LangGraph Workflow Processing
The application processes messages through an 8-node LangGraph workflow:

1. **validate** (`src/nodes.ts:validateNode`)
   - Validates message structure and content
   - Checks for mentions and determines processing need
   - Detects attack patterns and prompt injections
   - Sets `shouldProcess` flag in workflow state

2. **acknowledge** (`src/nodes.ts:acknowledgeNode`)
   - Sends contextual emoji reaction using Claude Haiku
   - Dynamic emoji selection based on content analysis:
     - 🤔 (default thinking)
     - 👀 (urgent/important questions)
     - 🙏 (polite requests with "please"/"thank you")
     - 📜 (Hebrew/Aramaic text questions)
     - 📚 (Talmudic questions)
   - Handles attack responses with 😞 emoji and polite guidance

3. **fetchContext** (`src/nodes.ts:fetchContextNode`)
   - Retrieves thread history (limited to 5 messages)
   - Builds conversation context for Claude API
   - Preserves thread continuity and context

4. **callClaude** (`src/nodes.ts:callClaudeNode`)
   - Calls Claude API with MCP integration for Sefaria access
   - Includes user intent analysis and language detection
   - Applies scholarly response guidelines and citation requirements

5. **validateSlackFormatting** (`src/nodes.ts:validateSlackFormattingNode`)
   - Checks for HTML links and markdown formatting issues
   - Determines if response needs formatting correction
   - Sets `needsSlackFormatting` flag for conditional routing

6. **formatResponse** (`src/nodes.ts:formatResponseNode`)
   - Applies Slack-compatible formatting using Claude Haiku
   - Converts markdown headers and links to Slack format
   - Adds coverage warnings for topics outside Jewish sources
   - Handles Sefaria URL encoding (spaces→underscores, verse references)

7. **sendResponse** (`src/nodes.ts:sendResponseNode`)
   - Posts formatted response to Slack
   - Handles thread replies and channel messages
   - Includes proper error handling and retry logic

8. **handleError** (`src/nodes.ts:handleErrorNode`)
   - Processes any errors that occur during workflow execution
   - Provides graceful error messages to users
   - Logs errors for debugging and monitoring

### MCP Integration
Uses Claude Messages API MCP connector with:
- Model: `claude-sonnet-4-20250514`
- MCP server configured as URL type with Sefaria endpoint
- Enhanced system prompt with scholarly response guidelines:
  - Multilingual support (responds in user's language)
  - User intent awareness (brief vs comprehensive responses)
  - Mandatory source citations with Sefaria links
  - Coverage limitation transparency
  - Unsourced claim identification

### Token Management
- Thread history limited to 5 messages
- Message content truncated to 2000 characters
- Max tokens set to 2000 to prevent overflow
- System prompt optimized for concise Slack formatting

### Slack Formatting
- Uses `mrkdwn: true` for proper Slack rendering
- Converts markdown headers (`#`, `##`, `###`) to `*bold*` format
- Converts `**bold**` to `*bold*` for Slack compatibility
- Link format: `[text](url)` → `<url|text>` with proper URL encoding:
  - Spaces in URLs replaced with underscores
  - Verse references (e.g., `3:4`) converted to periods (e.g., `3.4`)
  - Example: `[Genesis 3:4](https://www.sefaria.org/Genesis 3:4)` → `<https://www.sefaria.org/Genesis.3.4|Genesis 3:4>`
- Response cleaning removes tool usage references

## Development Notes

### TypeScript Configuration
- Target: ES2020 with CommonJS modules
- Strict mode enabled
- Output directory: `./dist`

### Error Handling Patterns
- Try/catch blocks in all async methods
- Console logging for debugging (no structured logging in MVP)
- Graceful fallback responses for API failures

### Testing Requirements
The app requires external services to function:
- Sefaria MCP server running on configured URL (typically ngrok tunnel)
- Valid Slack app with proper OAuth tokens
- Anthropic API access with MCP beta features enabled

### Advanced Response Features

#### Attack Detection and Prevention
- **Pattern Recognition**: Detects prompt injection, jailbreak attempts, and disingenuous questions
- **Response Strategy**: Uses disappointed emoji (😞) and provides constructive guidance
- **Security Patterns**: Monitors for system instruction bypasses, role-playing attempts, and exploitation attempts

#### Sefaria Coverage Assessment
- **Scope Detection**: Identifies topics outside Jewish textual sources
- **Coverage Warnings**: Alerts users when topics have limited source material
- **Transparency**: Clear distinction between sourced claims and analytical interpretations
- **Coverage Indicators**: Flags contemporary issues, general culture, and opinion-based questions

#### User Intent Recognition
- **Response Depth**: Adapts to user's desired level of detail
- **Intent Categories**: BRIEF_DEFINITION, YES_NO_ANSWER, SHORT_RESPONSE, COMPREHENSIVE_ANALYSIS, COMPARATIVE_ANALYSIS, SOURCE_HEAVY_RESPONSE
- **Context Clues**: Analyzes question structure, keywords, and length
- **Metadata Integration**: Passes intent analysis to Claude for appropriate response formatting

#### Multilingual Support
- **Language Detection**: Identifies Hebrew, Arabic, and English text
- **Response Matching**: Ensures response language matches user's primary language
- **Mixed Language Handling**: Uses framing language for mixed-language queries
- **Source Preservation**: Maintains accuracy of Hebrew/Aramaic sources while responding in user's language

#### Enhanced Citation System
- **Mandatory Sourcing**: All claims require Sefaria citations
- **Unsourced Disclaimers**: Clear identification of analytical vs. sourced content
- **Link Formatting**: Proper Slack-compatible Sefaria link conversion
- **Source Validation**: Ensures all references are properly formatted and accessible

### Thread Conversation Management
- **Thread detection**: Bot tracks threads where it has participated
- **Conversation continuity**: Follow-up messages in active threads are automatically processed without requiring mentions
- **Context preservation**: Thread history includes all relevant messages while filtering out acknowledgment reactions
- **Smart acknowledgment**: Uses context-aware emoji reactions based on question type and content

### Multi-Bot LangGraph Workflow Development

#### Bot-Specific Workflow Creation
To create a new bot with custom workflow behavior:

1. **Create Bot Workflow File**: `src/workflows/yourbot-workflow.ts`
```typescript
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

// Custom nodes for your bot (can override any base behavior)
const yourbotNodes: WorkflowNodes = {
  validateMessageNode,
  sendAcknowledgmentNode,
  fetchContextNode,
  callClaudeNode: customCallClaudeNode, // Custom implementation
  validateSlackFormattingNode,
  formatResponseNode,
  sendResponseNode,
  handleErrorNode
};

export function createYourbotWorkflow() {
  console.log('🤖 Creating Yourbot workflow...');
  return createBaseWorkflow(yourbotNodes);
}
```

2. **Update Workflow Factory**: Modify `getWorkflowFactory()` in `src/app.ts`
```typescript
private getWorkflowFactory(botName: string): () => any {
  switch (botName) {
    case 'bina':
      return createBinaWorkflow;
    case 'binah':
      return createBinahWorkflow;
    case 'yourbot':
      return createYourbotWorkflow;
    default:
      return createBinaWorkflow;
  }
}
```

#### Shared Workflow Node Modifications
- **Base Nodes**: All common behavior is in `src/nodes.ts` (shared across all bots)
- **Bot-Specific Overrides**: Individual bots can override specific nodes with custom implementations
- **Workflow Base**: Shared workflow structure in `src/workflows/workflow-base.ts`

#### Multi-Bot State Management
- **Shared State Schema**: `SlackWorkflowState` interface in `src/graph-types.ts` (used by all bots)
- **Bot-Specific Routing**: Each bot can have different conditional routing logic
- **Shared Infrastructure**: Common services (Slack, Claude API) shared across all bot workflows

#### Multi-Bot System Integration
- **Bot Registry**: Bot discovery and registration system in `src/bot-registry.ts`
- **Dynamic Routing**: Request routing to appropriate bot workflow in `src/app.ts`
- **Shared Services**: Claude service and MCP connector shared across all bots
- **Fallback Handler**: Legacy compatibility handler in `src/slack-handler.ts`

#### Testing Multi-Bot LangGraph Workflows
- **Bot-Specific Workflow Tests**: Test individual bot workflow implementations
- **Shared Node Tests**: Test common workflow nodes (`src/__tests__/integration/workflow-nodes.test.ts`)
- **Multi-Bot Integration Tests**: Test bot registry and routing system
- **Service Integration Tests**: Test shared services across multiple bots (`src/__tests__/integration/service-integration.test.ts`)
- **Error Handling Tests**: Test workflow error scenarios for all bot types