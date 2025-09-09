# Sefaria Slack MCP Multi-Bot Platform

A multi-bot Slack platform that integrates Claude LLM with Sefaria's Jewish text database through MCP (Model Context Protocol). The platform supports multiple specialized bots, each with their own personality and capabilities, all sharing common infrastructure.

## Features

### Multi-Bot Architecture
- **Dynamic Bot Routing**: Deploy multiple bots with different specializations
- **Shared Infrastructure**: Common services (Claude API, MCP) shared across all bots
- **Bot Registry System**: Automatic bot discovery and registration
- **Scalable Design**: Easy addition of new bots without code changes

### Bot Capabilities
- **Smart Message Processing**: Responds to @mentions and follows thread conversations
- **Scholarly Responses**: Provides comprehensive answers about Jewish texts with proper citations
- **Attack Detection**: Identifies and gracefully handles disingenuous or malicious questions
- **Multilingual Support**: Responds based on user's language
- **Source Validation**: All responses include Sefaria citations with proper link formatting
- **Coverage Warnings**: Alerts users when topics fall outside Jewish textual sources

### Current Bots
- **Bina** (בינה): Main scholarly assistant for general Jewish text inquiries
- **Binah** (בינה): Deep research variant for comprehensive analysis (planned)

## Architecture

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
- **`src/nodes.ts`** - Implementation of all 8 workflow nodes
- **`src/graph-types.ts`** - TypeScript interfaces for workflow state

### Multi-Bot Architecture Components

- **`src/app.ts`** - Express server with dynamic multi-bot routing
- **`src/bot-registry.ts`** - Bot discovery, registration, and management system
- **`src/workflows/`** - Bot-specific workflow implementations
- **`src/slack-handler.ts`** - Fallback message processing (legacy compatibility)
- **`src/claude-service.ts`** - Shared Claude API integration with MCP connector
- **`src/types.ts`** - TypeScript interfaces for all components

### API Endpoints

- `POST /slack/events` - Default webhook (routes to "bina" for backward compatibility)
- `POST /slack/events/:botName` - Bot-specific webhook endpoints
- `GET /health` - Health check endpoint with bot registry status

**Available Bot Routes:**
- `POST /slack/events/bina` - Bina bot endpoint
- `POST /slack/events/binah` - Binah bot endpoint (when configured)


## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Slack workspace with admin permissions
- Anthropic API key with MCP beta access
- Sefaria MCP server running (typically via ngrok tunnel)
- LangGraph dependencies (@langchain/langgraph, @langchain/core)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd slack-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables (see Configuration section)

4. Build the application:
```bash
npm run build
```

## Configuration

### Multi-Bot Environment Variables

The platform supports two configuration modes:

#### Option 1: Multi-Bot Configuration (Recommended)
Create a `.env` file with bot-specific configurations:

```bash
# Shared configuration (required)
ANTHROPIC_API_KEY=your-anthropic-api-key
SEFARIA_MCP_URL=https://your-ngrok-url.ngrok-free.app
PORT=3001

# Bot-specific configurations
# Pattern: BOTNAME_SLACK_TOKEN and BOTNAME_SIGNING_SECRET

# Bina bot (main scholarly assistant)
BINA_SLACK_TOKEN=xoxb-your-bina-bot-token
BINA_SIGNING_SECRET=your-bina-signing-secret

# Binah bot (deep research variant)
BINAH_SLACK_TOKEN=xoxb-your-binah-bot-token
BINAH_SIGNING_SECRET=your-binah-signing-secret
```

#### Option 2: Legacy Single-Bot Configuration
For backward compatibility, you can still use the original single-bot format:

```bash
# This will automatically be registered as the "bina" bot
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
ANTHROPIC_API_KEY=your-anthropic-key
SEFARIA_MCP_URL=https://your-ngrok-url.ngrok-free.app
PORT=3001
```

### Adding New Bots

To add a new bot:

1. **Add Environment Variables**: Follow the `BOTNAME_SLACK_TOKEN` and `BOTNAME_SIGNING_SECRET` pattern
2. **Create Workflow** (Optional): Add a new workflow in `src/workflows/yourbot-workflow.ts`
3. **Update Bot Registry**: The bot will be automatically discovered and registered
4. **Slack Webhook**: Configure your Slack app to use `https://your-domain.com/slack/events/yourbot`

The system automatically discovers bots based on environment variable patterns - no code changes needed!

## Running the Service

### Development Mode (with hot reload)
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

The service will start on the port specified in your environment variables (default: 3001).

### Multi-Bot Status

Check bot registration status:
```bash
curl http://localhost:3001/health
```

This will return information about registered bots:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "bots": [
    {"name": "bina", "description": null},
    {"name": "binah", "description": null}
  ],
  "botCount": 2
}
```

## LangGraph Workflow Details

### State Management
The workflow uses `SlackWorkflowState` to track:
- `slackEvent` - Input Slack message event
- `shouldProcess` - Processing decision flag
- `acknowledgmentSent` - Emoji reaction status
- `threadHistory` - Slack conversation context
- `conversationContext` - Claude API conversation format
- `claudeResponse` - Raw Claude API response
- `slackValidatedResponse` - Formatted response for Slack
- `error` and `errorOccurred` - Error handling state

### Advanced Features
- **Smart Slack Formatting Pipeline** - Automatic HTML/markdown conversion using Claude Haiku
- **Dynamic Emoji Selection** - Context-aware emoji reactions based on content analysis
- **Comprehensive Error Handling** - Graceful degradation with fallback mechanisms
- **Thread Context Management** - Conversation continuity across message threads

### Testing
The application includes comprehensive test coverage:
- **Workflow Integration Tests** - End-to-end workflow validation
- **Node-Level Tests** - Individual node function testing
- **Service Integration Tests** - API integration and error handling
