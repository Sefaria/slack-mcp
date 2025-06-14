# Slack App with Claude + Sefaria MCP Integration Spec

## Overview
A Slack app that enables seamless conversations with Claude LLM in Slack channels, with integrated access to Sefaria's Jewish text database through MCP.

## MVP Core Functionality
- **Channel Integration**: App works in all channels where installed
- **Mention-Only Mode**: Messages only sent to Claude when app is mentioned (@app-name)
- **Thread-based Conversations**: All AI responses and follow-ups contained within message threads
- **Context Management**: Conversation context maintained entirely within Slack thread history (no external persistence needed)
- **Sefaria Integration**: Claude has access to hardcoded Sefaria MCP server

## MVP Configuration (Global)
- **Message Mode**: Mention-only (hardcoded)
- **Sefaria MCP URL**: Hardcoded to `https://e32b-2a06-c701-99c6-7700-45b-40c9-5df6-e499.ngrok-free.app`
- **Anthropic API Key**: Single global API key via environment variable

## Technical Architecture
- **Slack Events API**: Listen for `message` events in all channels with app
- **Claude Messages API**: Direct MCP connector integration
- **Thread Context**: Read full Slack thread history to build conversation context
- **Configuration**: Environment variables only

## User Experience Flow
1. User mentions app in message (@app-name with question)
2. App reads full thread history for context
3. App sends conversation to Claude with Sefaria MCP access
4. Claude responds in thread
5. Subsequent mentions continue conversation in thread

## Implementation Notes
- Uses Slack thread history to reconstruct conversation context (no external persistence required)
- MCP server integration through Claude Messages API connector
- Single global configuration for MVP simplicity

## Deferred Features (Post-MVP)
- **Auto Mode**: All messages processed without mentions
- **Per-workspace Configuration**: Individual workspace settings
- **Slash Commands**: Configuration via Slack commands
- **Advanced Error Handling**: Retry logic, error hierarchy
- **Request Verification**: Slack signature validation
- **Token Management**: Smart context truncation
- **Logging**: Structured logging system
- **Health Checks**: System monitoring endpoints