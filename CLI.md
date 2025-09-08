# CLI Testing Mode

The Slack MCP platform includes a CLI testing mode for local development and testing without requiring Slack webhook connections. This is particularly useful for Docker container testing and development.

## Quick Start

### Local Development
```bash
# Run CLI in development mode
npm run cli

# Run built CLI
npm run build
npm run cli:built
```

### Docker Usage
```bash
# Build and run CLI in Docker
docker-compose --profile cli up slack-mcp-cli

# Or run server mode (default)
docker-compose --profile server up slack-mcp-server

# Development mode with hot reload
docker-compose --profile dev up slack-mcp-dev
```

## CLI Commands

Once in CLI mode, you can use these commands:

```
🤖 Slack MCP CLI Commands:

  help                    - Show help message
  bots                    - List available bots
  <botname> <message>     - Send message to specific bot
  <message>               - Send message to default bot (bina)
  quit, exit, q           - Exit the CLI

Examples:
  > Hello, what can you help me with?
  > bina What is the Mishnah?
  > binah Tell me about the Talmudic discussion on prayer
```

## Environment Configuration

The CLI uses the same environment variables as the server mode:

### Multi-Bot Configuration
```bash
# Shared configuration
ANTHROPIC_API_KEY=your-anthropic-key
SEFARIA_MCP_URL=https://your-ngrok-url.ngrok-free.app

# Bot-specific configurations
BINA_SLACK_TOKEN=test-token  # Can be dummy for CLI mode
BINA_SIGNING_SECRET=test-secret
```

### Legacy Configuration
```bash
# Will be registered as "bina" bot
SLACK_BOT_TOKEN=test-token
SLACK_SIGNING_SECRET=test-secret
ANTHROPIC_API_KEY=your-anthropic-key
SEFARIA_MCP_URL=https://your-ngrok-url.ngrok-free.app
```

**Note**: For CLI mode, the Slack tokens can be dummy values since no actual Slack API calls are made.

## How It Works

The CLI mode:

1. **Discovers Bots**: Uses the same bot discovery logic as server mode
2. **Creates Mock Events**: Generates mock Slack message events with proper structure
3. **Runs Full Workflows**: Executes the complete LangGraph workflow for each bot
4. **Shows Responses**: Displays formatted responses exactly as they would appear in Slack
5. **Preserves Formatting**: Maintains all Slack formatting rules for accurate testing

## Example Session

```bash
$ npm run cli:built

╔════════════════════════════════════════════════╗
║           Slack MCP CLI Testing Mode           ║
║                                                ║
║  Test your bots locally without Slack!        ║
║  Type 'help' for commands or 'quit' to exit   ║
╚════════════════════════════════════════════════╝

Available bots: [bina]

🤖 slack-mcp> What is the Talmud?

🔄 Processing with bot "bina"...
🔄 Running bina workflow...

📝 BINA Response:
──────────────────────────────────────────────────
The *Talmud* is a vast collection of Jewish oral teachings and commentary on the Torah...

<https://www.sefaria.org/Talmud|Learn more about the Talmud>
──────────────────────────────────────────────────

🤖 slack-mcp> bina Tell me about Shabbat

🔄 Processing with bot "bina"...
...
```

## Docker Profiles

The docker-compose.yml includes three profiles:

- **server**: Production server mode (default)
- **cli**: Interactive CLI mode for testing
- **dev**: Development mode with hot reload

## Testing Benefits

Using CLI mode provides:

- ✅ **No Slack Setup**: Test without configuring Slack webhooks
- ✅ **Container Testing**: Perfect for Docker development
- ✅ **Full Workflows**: Tests complete LangGraph workflow execution
- ✅ **Real Responses**: Uses actual Claude API calls (with valid API key)
- ✅ **Multiple Bots**: Test different bot personalities
- ✅ **Slack Formatting**: Validates Slack-compatible formatting

This makes it easy to develop, test, and debug your bots locally before deploying to production.