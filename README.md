# Sefaria Slack MCP Bot


A Slack app that integrates Claude LLM with Sefaria's Jewish text database through MCP (Model Context Protocol). 
The bot responds to mentions in Slack channels and provides scholarly responses.

## Features

- **Smart Message Processing**: Responds to @mentions and follows thread conversations
- **Scholarly Responses**: Provides comprehensive answers about Jewish texts with proper citations
- **Attack Detection**: Identifies and gracefully handles disingenuous or malicious questions
- **Multilingual Support**: Responds based on user's language
- **Source Validation**: All responses include Sefaria citations with proper link formatting
- **Coverage Warnings**: Alerts users when topics fall outside Jewish textual sources

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
- **`src/workflow.ts`** - LangGraph StateGraph definition with routing logic
- **`src/nodes.ts`** - Implementation of all 8 workflow nodes
- **`src/graph-types.ts`** - TypeScript interfaces for workflow state

### Core Components

- **`src/app.ts`** - Express server with Slack Events API webhook handling
- **`src/slack-handler.ts`** - Message processing with mention detection and thread management
- **`src/claude-service.ts`** - Claude API integration with MCP connector
- **`src/types.ts`** - TypeScript interfaces for all components

### API Endpoints

- `POST /slack/events` - Slack Events API webhook
- `GET /health` - Health check endpoint


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

### Environment Variables

Create a `.env` file in the root directory:

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
ANTHROPIC_API_KEY=your-anthropic-key
SEFARIA_MCP_URL=https://your-ngrok-url.ngrok-free.app
PORT=3001
```

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
