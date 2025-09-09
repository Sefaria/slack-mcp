import { createInterface } from 'readline';
import dotenv from 'dotenv';
import { SlackMessageEvent } from './types';
import { botRegistry, BotConfig } from './bot-registry';
import { initializeServicesForCLI } from './nodes';
import { createBinaWorkflow } from './workflows/bina-workflow';
import { createBinahWorkflow } from './workflows/binah-workflow';

dotenv.config();

interface CLIConfig {
  ANTHROPIC_API_KEY: string;
  SEFARIA_MCP_URL: string;
}

class SlackMCPCLI {
  private config: CLIConfig;
  private readline: any;

  constructor() {
    this.config = this.loadConfig();
    this.discoverAndRegisterBots();
    this.readline = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '🤖 slack-mcp> '
    });
  }

  private loadConfig(): CLIConfig {
    const requiredEnvVars = ['ANTHROPIC_API_KEY', 'SEFARIA_MCP_URL'];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    return {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
      SEFARIA_MCP_URL: process.env.SEFARIA_MCP_URL!,
    };
  }

  private discoverAndRegisterBots(): void {
    console.log('🔍 Discovering bots for CLI mode...');
    
    // Find all bot-specific environment variables
    const botNames = new Set<string>();
    for (const envVar in process.env) {
      const match = envVar.match(/^(\w+)_SLACK_TOKEN$/);
      if (match) {
        const botName = match[1].toLowerCase();
        botNames.add(botName);
      }
    }

    if (botNames.size === 0) {
      // Fallback: check for legacy single-bot config or create test config
      if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET) {
        console.log('📦 Found legacy single-bot config, registering as "bina"');
        this.registerBot({
          name: 'bina',
          slackToken: process.env.SLACK_BOT_TOKEN,
          signingSecret: process.env.SLACK_SIGNING_SECRET,
          workflowFactory: createBinaWorkflow,
          description: 'Main scholarly assistant (legacy config)'
        });
      } else {
        // Create test bot configuration for CLI mode
        console.log('🧪 No bot configs found, creating test "bina" bot for CLI mode');
        this.registerBot({
          name: 'bina',
          slackToken: 'cli-test-token',
          signingSecret: 'cli-test-secret',
          workflowFactory: createBinaWorkflow,
          description: 'Test bot for CLI mode'
        });
      }
    } else {
      // Register discovered bots
      for (const botName of botNames) {
        const tokenVar = `${botName.toUpperCase()}_SLACK_TOKEN`;
        const secretVar = `${botName.toUpperCase()}_SIGNING_SECRET`;
        
        if (!process.env[tokenVar] || !process.env[secretVar]) {
          console.warn(`⚠️ Bot "${botName}" missing required environment variables, skipping`);
          continue;
        }

        this.registerBot({
          name: botName,
          slackToken: process.env[tokenVar]!,
          signingSecret: process.env[secretVar]!,
          workflowFactory: this.getWorkflowFactory(botName),
          description: `${botName} bot`
        });
      }
    }

    console.log(`✅ Registered ${botRegistry.getBotCount()} bots for CLI: [${botRegistry.listBots().join(', ')}]`);
  }

  private getWorkflowFactory(botName: string): () => any {
    switch (botName) {
      case 'bina':
        return createBinaWorkflow;
      case 'binah':
        return createBinahWorkflow;
      default:
        console.warn(`⚠️ No specific workflow for bot "${botName}", using bina workflow`);
        return createBinaWorkflow;
    }
  }

  private registerBot(config: BotConfig): void {
    botRegistry.registerBot(config);
    
    // Initialize services for this bot using CLI-specific initialization
    initializeServicesForCLI(
      config.name,
      this.config.ANTHROPIC_API_KEY,
      this.config.SEFARIA_MCP_URL
    );
  }

  private createMockSlackEvent(message: string, botName: string): SlackMessageEvent {
    const timestamp = Date.now().toString();
    // Use a realistic bot user ID format that will match the validation
    const botMention = `<@U${botName.toUpperCase()}123456>`;
    
    return {
      type: 'message',
      user: 'CLI_USER',
      text: `${botMention} ${message}`,
      ts: timestamp,
      channel: 'CLI_CHANNEL',
      event_ts: timestamp,
      channel_type: 'channel'
    };
  }

  private async processMessage(message: string, botName: string): Promise<void> {
    const bot = botRegistry.getBot(botName);
    if (!bot) {
      console.log(`❌ Bot "${botName}" not found. Available bots: [${botRegistry.listBots().join(', ')}]`);
      return;
    }

    console.log(`\n🔄 Processing with bot "${botName}"...`);
    
    try {
      // Create mock Slack event with bot name for validation
      const mockEvent = this.createMockSlackEvent(message, botName);
      
      // Create bot-specific workflow instance
      const workflow = bot.workflowFactory();
      
      const initialState = {
        slackEvent: mockEvent,
        shouldProcess: false,
        acknowledgmentSent: false,
        threadHistory: [],
        conversationContext: [],
        messageText: null,
        claudeResponse: null,
        needsSlackFormatting: false,
        slackValidatedResponse: null,
        formattedResponse: null,
        error: null,
        errorOccurred: false
      };

      console.log(`🔄 Running ${botName} workflow...`);
      const result = await workflow.invoke(initialState);
      
      if (result.errorOccurred) {
        console.log(`❌ Error: ${result.error}`);
      } else if (result.formattedResponse) {
        console.log(`\n📝 ${botName.toUpperCase()} Response:`);
        console.log('─'.repeat(50));
        console.log(result.formattedResponse);
        console.log('─'.repeat(50));
      } else if (result.claudeResponse) {
        console.log(`\n📝 ${botName.toUpperCase()} Response (raw):`);
        console.log('─'.repeat(50));
        console.log(result.claudeResponse);
        console.log('─'.repeat(50));
      } else if (!result.shouldProcess) {
        console.log(`ℹ️ No response generated (shouldProcess: ${result.shouldProcess})`);
      } else {
        console.log(`ℹ️ Workflow completed but no response found. Final state:`);
        console.log({
          shouldProcess: result.shouldProcess,
          acknowledgmentSent: result.acknowledgmentSent,
          hasClaudeResponse: !!result.claudeResponse,
          hasFormattedResponse: !!result.formattedResponse,
          errorOccurred: result.errorOccurred
        });
      }
      
    } catch (error) {
      console.log(`❌ Workflow execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private showHelp(): void {
    console.log(`
🤖 Slack MCP CLI Commands:

  help                    - Show this help message
  bots                    - List available bots
  @<botname> <message>    - Send message to specific bot
  <message>               - Record message (no bot response, like Slack)
  quit, exit, q           - Exit the CLI

Examples:
  > Hello everyone! (recorded, no response)
  > @bina What is the Mishnah?
  > @binah Tell me about the Talmudic discussion on prayer

Available bots: [${botRegistry.listBots().join(', ')}]
`);
  }

  public async start(): Promise<void> {
    console.log(`
╔══════════════════════════════════════════════════╗
║            Slack MCP CLI Testing Mode            ║
║                                                  ║
║    Test your bots locally without Slack!         ║
║    Type 'help' for commands or 'quit' to exit    ║
╚══════════════════════════════════════════════════╝
`);

    this.showHelp();
    this.readline.prompt();

    this.readline.on('line', async (input: string) => {
      const trimmed = input.trim();
      
      if (!trimmed) {
        this.readline.prompt();
        return;
      }

      try {
        // Check for special commands first
        if (trimmed === 'help') {
          this.showHelp();
          return;
        }
        
        if (trimmed === 'bots') {
          console.log(`\nAvailable bots: [${botRegistry.listBots().join(', ')}]`);
          return;
        }
        
        if (trimmed === 'quit' || trimmed === 'exit' || trimmed === 'q') {
          console.log('👋 Goodbye!');
          process.exit(0);
          return;
        }

        // Check for @mention pattern: @botname followed by non-word character or end of string
        const mentionMatch = trimmed.match(/^@(\w+)(?:\W|$)/);
        if (mentionMatch) {
          const botName = mentionMatch[1].toLowerCase();
          if (botRegistry.hasBot(botName)) {
            const message = trimmed.substring(mentionMatch[0].length).trim();
            if (message) {
              await this.processMessage(message, botName);
            } else {
              console.log(`❌ Please provide a message for bot "${botName}"`);
            }
          } else {
            console.log(`❌ Bot "@${botName}" not found. Available bots: [${botRegistry.listBots().join(', ')}]`);
          }
        } else {
          // No @mention - in real Slack, this wouldn't trigger any bot
          console.log(`💬 Message recorded: "${trimmed}" (no bot mentioned, no response generated)`);
        }
      } catch (error) {
        console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      }

      console.log(); // Add blank line
      this.readline.prompt();
    });

    this.readline.on('close', () => {
      console.log('\n👋 Goodbye!');
      process.exit(0);
    });
  }
}

// Start CLI if this file is run directly
if (require.main === module) {
  const cli = new SlackMCPCLI();
  cli.start().catch(error => {
    console.error('Failed to start CLI:', error);
    process.exit(1);
  });
}

export { SlackMCPCLI };