# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Slack app that integrates Claude LLM with Sefaria's Jewish text database through MCP (Model Context Protocol). The app responds to mentions in Slack channels and provides scholarly responses about Jewish texts using Claude's API with MCP server access.

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
- **`src/workflow.ts`** - LangGraph StateGraph definition with routing logic
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

### Core Components

1. **`src/app.ts`** - Express server with Slack Events API webhook handling and LangGraph workflow initialization
2. **`src/slack-handler.ts`** - Fallback message processing (used when LangGraph workflow fails)
3. **`src/claude-service.ts`** - Claude API integration with MCP connector
4. **`src/types.ts`** - TypeScript interfaces for all components

### Key Dependencies
- **Express v4.21.2** (v5 has TypeScript compatibility issues)
- **@slack/web-api** for Slack integration
- **@anthropic-ai/sdk** for Claude API
- **@langchain/langgraph** for workflow orchestration
- **@langchain/core** for LangGraph annotations and utilities
- **MCP Integration** via Claude Messages API with `anthropic-beta: mcp-client-2025-04-04` header

### API Endpoints
- `POST /slack/events` - Slack Events API webhook
- `GET /health` - Health check endpoint

## Configuration

### Required Environment Variables
```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
ANTHROPIC_API_KEY=your-anthropic-key
SEFARIA_MCP_URL=https://your-ngrok-url.ngrok-free.app
PORT=3001
```

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

### LangGraph Workflow Development

#### Workflow Node Modifications
- **validate Node**: Update attack detection patterns in `src/nodes.ts:validateNode`
- **acknowledge Node**: Modify emoji selection logic in `src/nodes.ts:acknowledgeNode`
- **fetchContext Node**: Adjust thread history limits in `src/nodes.ts:fetchContextNode`
- **callClaude Node**: Update Claude API integration in `src/nodes.ts:callClaudeNode`
- **validateSlackFormatting Node**: Modify formatting validation in `src/nodes.ts:validateSlackFormattingNode`
- **formatResponse Node**: Update Slack formatting logic in `src/nodes.ts:formatResponseNode`
- **sendResponse Node**: Modify Slack posting logic in `src/nodes.ts:sendResponseNode`
- **handleError Node**: Update error handling in `src/nodes.ts:handleErrorNode`

#### Workflow State Management
- **State Schema**: Modify `SlackWorkflowState` interface in `src/graph-types.ts`
- **Routing Logic**: Update conditional routing in `src/workflow.ts`
- **State Transitions**: Adjust state updates in individual node functions

#### System Integration
- **Workflow Initialization**: Update workflow setup in `src/app.ts`
- **Fallback Handler**: Modify fallback logic in `src/slack-handler.ts` (used when LangGraph fails)
- **Service Integration**: Update Claude service integration in workflow nodes

#### Testing LangGraph Workflows
- **Workflow Integration Tests**: End-to-end workflow validation (`src/__tests__/integration/workflow-integration.test.ts`)
- **Node-Level Tests**: Individual node function testing (`src/__tests__/integration/workflow-nodes.test.ts`)
- **Service Integration Tests**: API integration testing (`src/__tests__/integration/service-integration.test.ts`)
- **State Management Tests**: Workflow state transition validation
- **Error Handling Tests**: Workflow error scenarios and recovery