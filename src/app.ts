import express from 'express';
import dotenv from 'dotenv';
import { SlackHandlerImpl } from './slack-handler';
import { ClaudeServiceImpl } from './claude-service';
import { SlackMessageEvent } from './types';
import { botRegistry, BotConfig } from './bot-registry';
import { createBinaWorkflow } from './workflows/bina-workflow';
import { createBinahWorkflow } from './workflows/binah-workflow';
import { initializeServices } from './nodes';

dotenv.config();

interface SharedConfig {
  ANTHROPIC_API_KEY: string;
  SEFARIA_MCP_URL: string;
  PORT: number;
}

class SlackMCPApp {
  private app: express.Application;
  private sharedConfig: SharedConfig;
  private fallbackHandler: SlackHandlerImpl | null = null;
  private botInfoCache: Map<string, {name: string, appId?: string, userId?: string}> = new Map(); // bot_id -> bot info
  private processedMessages: Set<string> = new Set(); // message deduplication

  constructor() {
    this.app = express();
    this.sharedConfig = this.loadSharedConfig();
  }

  private loadSharedConfig(): SharedConfig {
    const requiredEnvVars = [
      'ANTHROPIC_API_KEY',
      'SEFARIA_MCP_URL'
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required shared environment variable: ${envVar}`);
      }
    }

    return {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
      SEFARIA_MCP_URL: process.env.SEFARIA_MCP_URL!,
      PORT: parseInt(process.env.PORT || '3001', 10)
    };
  }

  private async discoverAndRegisterBots(): Promise<void> {
    console.log('🔍 Discovering bots from environment variables...');
    
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
      // Fallback: check for legacy single-bot config
      if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET) {
        console.log('📦 Found legacy single-bot config, registering as "bina"');
        await this.registerBot({
          name: 'bina',
          slackToken: process.env.SLACK_BOT_TOKEN,
          signingSecret: process.env.SLACK_SIGNING_SECRET,
          workflowFactory: createBinaWorkflow
        });
        
        // Create fallback handler for backward compatibility
        const claudeService = new ClaudeServiceImpl(
          this.sharedConfig.ANTHROPIC_API_KEY,
          this.sharedConfig.SEFARIA_MCP_URL
        );
        this.fallbackHandler = new SlackHandlerImpl(
          process.env.SLACK_BOT_TOKEN,
          claudeService
        );
      } else {
        throw new Error('No bot configurations found. Please set BOTNAME_SLACK_TOKEN and BOTNAME_SIGNING_SECRET environment variables.');
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

        await this.registerBot({
          name: botName,
          slackToken: process.env[tokenVar]!,
          signingSecret: process.env[secretVar]!,
          workflowFactory: this.getWorkflowFactory(botName)
        });
      }
    }

    console.log(`✅ Registered ${botRegistry.getBotCount()} bots: [${botRegistry.listBots().join(', ')}]`);
  }

  private getWorkflowFactory(botName: string): () => any {
    // For now, all bots use the same workflow, but this can be extended
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

  private async detectBotFromMessage(requestBody: any): Promise<string> {
    console.log('🔍 [BOT-DETECT] Attempting to detect bot from message...');
    
    // Handle URL verification requests
    if (requestBody.type === 'url_verification') {
      console.log('🔍 [BOT-DETECT] URL verification request, defaulting to bina');
      return 'bina';
    }

    // Extract the message event
    const event = requestBody.event;
    if (!event || event.type !== 'message') {
      console.log('🔍 [BOT-DETECT] No message event, defaulting to bina');
      return 'bina';
    }

    // Use bots.info API for dynamic bot identification when bot_id is present
    if (event.bot_id) {
      console.log(`🔍 [BOT-DETECT] Message has bot_id: ${event.bot_id}`);
      const identifiedBot = await this.identifyBotFromBotId(event.bot_id);
      if (identifiedBot) {
        console.log(`🎯 [BOT-DETECT] Successfully identified bot "${identifiedBot}" from bot_id ${event.bot_id}`);
        return identifiedBot;
      }
      console.log(`⚠️ [BOT-DETECT] Could not identify bot from bot_id ${event.bot_id}`);
    }

    // Default to bina for backward compatibility (handles mentions, direct messages, etc.)
    console.log('🔍 [BOT-DETECT] No bot_id or identification failed, defaulting to bina');
    return 'bina';
  }


  // Identify which bot a message came from using bot_id and bots.info API
  async identifyBotFromBotId(botId: string): Promise<string | null> {
    if (!botId) return null;
    
    // Check cache first
    const cachedInfo = this.botInfoCache.get(botId);
    if (cachedInfo) {
      console.log(`🎯 [BOT-ID] Using cached bot info for ${botId}: ${cachedInfo.name}`);
      return cachedInfo.name;
    }
    
    console.log(`🔍 [BOT-ID] Looking up bot info for bot_id: ${botId}`);
    
    // Try to get bot info using any available Slack token
    // We'll use the first registered bot's token for the API call
    const registeredBots = botRegistry.listBots();
    if (registeredBots.length === 0) {
      console.warn(`⚠️ [BOT-ID] No registered bots available for API lookup`);
      return null;
    }
    
    for (const botName of registeredBots) {
      try {
        const bot = botRegistry.getBot(botName);
        if (!bot) continue;
        
        const webClient = new (await import('@slack/web-api')).WebClient(bot.slackToken);
        const result = await webClient.bots.info({ bot: botId });
        
        if (result.ok && result.bot) {
          const botInfo = {
            name: result.bot.name || 'unknown',
            appId: result.bot.app_id,
            userId: result.bot.user_id
          };
          
          // Cache the result
          this.botInfoCache.set(botId, botInfo);
          
          console.log(`✅ [BOT-ID] Retrieved bot info for ${botId}:`, botInfo);
          
          // Check if this bot belongs to one of our registered bots by matching app_id or name
          const matchingBot = registeredBots.find(name => {
            const registeredBot = botRegistry.getBot(name);
            // We can match by name (if bot names match our bot names)
            // or later implement app_id matching if needed
            return name === botInfo.name.toLowerCase();
          });
          
          return matchingBot || botInfo.name;
        }
      } catch (error) {
        console.log(`⚠️ [BOT-ID] Failed to lookup bot info with ${botName} token:`, error instanceof Error ? error.message : String(error));
        continue;
      }
    }
    
    console.warn(`❌ [BOT-ID] Could not retrieve bot info for bot_id: ${botId}`);
    return null;
  }

  private async registerBot(config: BotConfig): Promise<void> {
    botRegistry.registerBot(config);
    
    // Initialize services for this bot
    initializeServices(
      config.slackToken,
      this.sharedConfig.ANTHROPIC_API_KEY,
      this.sharedConfig.SEFARIA_MCP_URL
    );

    // Bot registration complete - user ID lookup handled dynamically via bots.info API
  }

  async initialize(): Promise<void> {
    // First, discover and register bots
    await this.discoverAndRegisterBots();
    
    // Add request logging middleware for debugging
    this.app.use((req, res, next) => {
      console.log(`🌐 ${new Date().toISOString()} - ${req.method} ${req.path}`);
      if (req.path.includes('/slack/events')) {
        console.log(`📋 Headers:`, JSON.stringify(req.headers, null, 2));
        console.log(`📋 Body:`, JSON.stringify(req.body, null, 2));
      }
      next();
    });
    
    this.app.use(express.json());
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      const bots = botRegistry.getAllBots().map(bot => ({
        name: bot.name,
        description: bot.description
      }));
      
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        bots: bots,
        botCount: botRegistry.getBotCount()
      });
    });

    // Smart default route that detects the correct bot from mentions
    this.app.post('/slack/events', async (req, res) => {
      const botName = await this.detectBotFromMessage(req.body);
      this.handleSlackEvent(req, res, botName);
    });

    // Dynamic bot-specific routes
    this.app.post('/slack/events/:botName', (req, res) => {
      const botName = req.params.botName.toLowerCase();
      this.handleSlackEvent(req, res, botName);
    });
  }

  private async handleSlackEvent(req: express.Request, res: express.Response, botName: string): Promise<void> {
    console.log(`📨 Received Slack event for bot "${botName}":`, JSON.stringify(req.body, null, 2));
    
    const { type, event } = req.body;

    try {
      // Handle URL verification challenge FIRST, before bot lookup
      // This allows Slack to verify the URL even if bot isn't fully configured yet
      if (type === 'url_verification') {
        console.log(`✅ URL verification challenge received for bot "${botName}"`);
        res.json({ challenge: req.body.challenge });
        return;
      }

      // Now check if bot exists (only needed for actual message processing)
      const bot = botRegistry.getBot(botName);
      if (!bot) {
        console.error(`❌ Bot "${botName}" not found`);
        res.status(404).json({ 
          error: `Bot '${botName}' not found`, 
          availableBots: botRegistry.listBots() 
        });
        return;
      }

      // Handle message events
      if (type === 'event_callback' && event?.type === 'message') {
        console.log(`💬 Processing message event for bot "${botName}" with LangGraph:`, event);
        
        // Create unique message ID for deduplication
        const messageId = `${event.channel}-${event.ts}`;
        
        // Check if we've already processed this message
        if (this.processedMessages.has(messageId)) {
          console.log(`⚠️ [DEDUP] Message ${messageId} already processed, skipping duplicate`);
          res.status(200).send('OK');
          return;
        }
        
        // Mark message as processed
        this.processedMessages.add(messageId);
        console.log(`✅ [DEDUP] Marked message ${messageId} as processed`);
        
        // Clean up old processed messages (keep last 1000)
        if (this.processedMessages.size > 1000) {
          const messagesToRemove = Array.from(this.processedMessages).slice(0, 500);
          messagesToRemove.forEach(id => this.processedMessages.delete(id));
          console.log(`🧹 [DEDUP] Cleaned up ${messagesToRemove.length} old message IDs`);
        }
        
        // Respond quickly to avoid timeout
        res.status(200).send('OK');
        
        // Process message asynchronously using bot-specific workflow
        this.processWithWorkflow(event as SlackMessageEvent, bot).catch(error => {
          console.error(`Error processing message with workflow for bot "${botName}":`, error);
        });
        return;
      }

      console.log(`ℹ️ Unhandled event type for bot "${botName}":`, type, event?.type);
      res.status(200).send('OK');
    } catch (error) {
      console.error(`Error processing Slack event for bot "${botName}":`, error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async processWithWorkflow(event: SlackMessageEvent, bot: BotConfig): Promise<void> {
    try {
      console.log(`🔄 [WORKFLOW] Starting LangGraph workflow for bot "${bot.name}"...`);
      console.log('🔄 [WORKFLOW] Event summary:', {
        user: event.user,
        channel: event.channel,
        ts: event.ts,
        thread_ts: event.thread_ts,
        text_preview: event.text?.substring(0, 100)
      });
      
      // Resolve bot user ID dynamically for proper mention validation
      let botUserId: string | undefined;
      try {
        const webClient = new (await import('@slack/web-api')).WebClient(bot.slackToken);
        const result = await webClient.auth.test();
        botUserId = result.user_id as string;
        console.log(`🤖 [WORKFLOW] Resolved user ID for bot "${bot.name}": ${botUserId}`);
      } catch (error) {
        console.warn(`⚠️ [WORKFLOW] Failed to resolve user ID for bot "${bot.name}":`, error instanceof Error ? error.message : String(error));
        botUserId = undefined;
      }
      
      // Create bot-specific workflow instance
      const workflow = bot.workflowFactory();
      
      const initialState = {
        slackEvent: event,
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
        errorOccurred: false,
        // Add bot context for validation with resolved user ID
        botContext: {
          name: bot.name,
          userId: botUserId
        }
      };

      console.log(`🔄 [WORKFLOW] Initial state created for bot "${bot.name}", invoking workflow...`);
      const result = await workflow.invoke(initialState);
      
      console.log(`✅ [WORKFLOW] Workflow completed successfully for bot "${bot.name}"`);
      console.log('✅ [WORKFLOW] Final state:', {
        shouldProcess: result.shouldProcess,
        acknowledgmentSent: result.acknowledgmentSent,
        hasThreadHistory: !!result.threadHistory?.length,
        hasConversationContext: !!result.conversationContext?.length,
        hasClaudeResponse: !!result.claudeResponse,
        hasFormattedResponse: !!result.formattedResponse,
        errorOccurred: result.errorOccurred,
        error: result.error
      });
      
    } catch (error) {
      console.error(`❌ [WORKFLOW] Workflow execution failed for bot "${bot.name}":`, error);
      console.error('❌ [WORKFLOW] Error type:', error?.constructor?.name);
      console.error('❌ [WORKFLOW] Error message:', error instanceof Error ? error.message : String(error));
      console.error('❌ [WORKFLOW] Error stack:', error instanceof Error ? error.stack : 'No stack');
      
      // Fallback to original handler for critical failures (only if available)
      if (this.fallbackHandler) {
        console.log(`🔄 [WORKFLOW] Falling back to original handler for bot "${bot.name}"...`);
        try {
          await this.fallbackHandler.handleMessage(event);
          console.log(`✅ [WORKFLOW] Fallback handler completed successfully for bot "${bot.name}"`);
        } catch (fallbackError) {
          console.error(`❌ [WORKFLOW] Fallback handler also failed for bot "${bot.name}":`, fallbackError);
        }
      } else {
        console.error(`❌ [WORKFLOW] No fallback handler available for bot "${bot.name}"`);
      }
    }
  }

  async start(port: number = this.sharedConfig.PORT): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(port, () => {
        console.log(`🚀 Slack MCP App listening on port ${port}`);
        console.log(`📋 Health check: http://localhost:${port}/health`);
        console.log(`🔗 Slack webhook: http://localhost:${port}/slack/events`);
        resolve();
      });
    });
  }
}

// Start the application
async function main() {
  try {
    const app = new SlackMCPApp();
    await app.initialize();
    await app.start();
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { SlackMCPApp };