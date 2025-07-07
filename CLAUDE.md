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

### 4-File MVP Structure
The application follows a simple 4-file architecture:

1. **`src/app.ts`** - Express server with Slack Events API webhook handling
2. **`src/slack-handler.ts`** - Message processing with mention detection and thread management
3. **`src/claude-service.ts`** - Claude API integration with MCP connector
4. **`src/types.ts`** - TypeScript interfaces for all components

### Key Dependencies
- **Express v4.21.2** (v5 has TypeScript compatibility issues)
- **@slack/web-api** for Slack integration
- **@anthropic-ai/sdk** for Claude API
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

### Enhanced Message Processing Flow
1. **Attack Detection**: First checks for disingenuous/attack questions using pattern matching
2. **Attack Response**: Reacts with 😞 emoji and sends polite refusal with guidance for better questions
3. **Initial messages**: App responds to messages where it's mentioned (@app-name)
4. **Follow-up messages**: App automatically processes subsequent messages in threads where it has participated
5. **Smart acknowledgment**: Uses context-aware emoji reactions:
   - 🤔 (default thinking)
   - 👀 (urgent/important questions)
   - 🙏 (polite requests with "please"/"thank you")
   - 📜 (Hebrew/Aramaic text questions)
   - 📚 (Talmudic questions)
6. **User intent analysis**: Analyzes question type to determine appropriate response depth
7. **Thread context**: Reads thread history (limited to 5 messages) with intent metadata
8. **Response validation**: Checks for Sefaria coverage limitations and adds warnings
9. **Language detection**: Ensures response matches user's language
10. **Response delivery**: Sends formatted, validated response with proper citations

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

### Common Development Tasks

#### Response System Modifications
- **Attack Detection**: Update patterns in `isAttackQuestion()` method
- **Intent Analysis**: Modify `analyzeUserIntent()` for new question types
- **Coverage Assessment**: Update `checkSefariaCoverage()` validation logic
- **Emoji Reactions**: Adjust `getAcknowledgmentEmoji()` for new contexts

#### System Prompt Updates
- **Claude Service**: Modify system prompt in `claude-service.ts` for response guidelines
- **Language Instructions**: Update multilingual response requirements
- **Citation Requirements**: Adjust source citation and disclaimer formatting

#### Validation and Quality Control
- **Response Validation**: Test `validateResponse()` method for coverage warnings
- **Message Formatting**: Verify `cleanResponse()` handles all markdown conversions
- **Thread Handling**: Ensure `shouldProcessMessage()` and `hasBotParticipatedInThread()` work correctly
- **Language Detection**: Validate `detectLanguage()` accuracy for different scripts

#### Testing Scenarios
- **Attack Questions**: Test various prompt injection and jailbreak attempts
- **Coverage Edge Cases**: Verify warnings for non-Jewish topics and contemporary issues  
- **Multilingual Responses**: Test Hebrew, Arabic, and English question handling
- **Intent Recognition**: Validate response depth matching for different question types
- **Citation Formatting**: Ensure all Sefaria links convert properly to Slack format