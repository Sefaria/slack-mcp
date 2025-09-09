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
  private botUserIdCache: Map<string, string> = new Map(); // botName -> userId
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

  private detectBotFromMessage(requestBody: any): string {
    console.log('🔍 [BOT-DETECT] Attempting to detect bot from message...');
    
    // First check if this is a URL verification (no message analysis needed)
    if (requestBody.type === 'url_verification') {
      console.log('🔍 [BOT-DETECT] URL verification request, defaulting to bina');
      return 'bina';
    }

    // Extract the message text
    const event = requestBody.event;
    if (!event || event.type !== 'message') {
      console.log('🔍 [BOT-DETECT] No message event, defaulting to bina');
      return 'bina';
    }

    const messageText = event.text || '';
    console.log('🔍 [BOT-DETECT] Message text:', messageText.substring(0, 100));

    // Extract mentioned user IDs
    const mentions = messageText.match(/<@(U[A-Z0-9]+)>/g);
    if (!mentions || mentions.length === 0) {
      console.log('🔍 [BOT-DETECT] No mentions found, defaulting to bina');
      return 'bina';
    }

    const mentionedUserIds = mentions.map((m: string) => m.match(/<@(U[A-Z0-9]+)>/)![1]);
    console.log('🔍 [BOT-DETECT] Mentioned user IDs:', mentionedUserIds);

    // Check each bot's user ID against the mentions
    const allBots = botRegistry.getAllBots();
    console.log('🔍 [BOT-DETECT] Checking against', allBots.length, 'registered bots');
    console.log('🔍 [BOT-DETECT] Current cache contents:', Object.fromEntries(this.botUserIdCache.entries()));

    for (const bot of allBots) {
      console.log('🔍 [BOT-DETECT] Checking bot:', bot.name);
      
      const botUserIdCandidate = this.getBotUserIdCandidate(bot.name, mentionedUserIds);
      if (botUserIdCandidate) {
        console.log(`🎯 [BOT-DETECT] Detected bot "${bot.name}" from mention ${botUserIdCandidate}`);
        return bot.name;
      }
    }

    // If no specific bot detected, fall back to bina for backward compatibility
    console.log('🔍 [BOT-DETECT] No specific bot detected, defaulting to bina');
    return 'bina';
  }

  private getBotUserIdCandidate(botName: string, mentionedUserIds: string[]): string | null {
    // Check if any of the mentioned user IDs match this bot's cached user ID
    const cachedBotUserId = this.botUserIdCache.get(botName);
    
    if (!cachedBotUserId) {
      console.log(`🔍 [BOT-DETECT] No cached user ID for bot "${botName}" - using fallback heuristic mapping`);
      
      // Fallback heuristic mapping for cases where API caching failed
      // This is based on known user IDs from your deployment
      const fallbackMapping: Record<string, string> = {
        'binah': 'U090X3GGN93',  // Based on your logs - binah bot has this user ID
        'bina': 'U09EBP618TW'    // Based on your logs - bina bot has this user ID  
      };
      
      const fallbackUserId = fallbackMapping[botName];
      if (fallbackUserId && mentionedUserIds.includes(fallbackUserId)) {
        console.log(`🎯 [BOT-DETECT] Fallback mapping found match for bot "${botName}": ${fallbackUserId}`);
        return fallbackUserId;
      }
      
      console.log(`🔍 [BOT-DETECT] No fallback mapping match for bot "${botName}"`);
      return null;
    }
    
    if (mentionedUserIds.includes(cachedBotUserId)) {
      console.log(`🎯 [BOT-DETECT] Found matching user ID for bot "${botName}": ${cachedBotUserId}`);
      return cachedBotUserId;
    }
    
    console.log(`🔍 [BOT-DETECT] No matching user ID for bot "${botName}" (cached: ${cachedBotUserId}, mentions: ${mentionedUserIds.join(', ')})`);
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

    // Cache the bot's user ID for routing
    try {
      const webClient = new (await import('@slack/web-api')).WebClient(config.slackToken);
      const result = await webClient.auth.test();
      const botUserId = result.user_id as string;
      this.botUserIdCache.set(config.name, botUserId);
      console.log(`📝 [BOT-CACHE] Cached user ID for bot "${config.name}": ${botUserId}`);
    } catch (error) {
      console.error(`❌ [BOT-CACHE] Failed to cache user ID for bot "${config.name}":`, error);
    }
  }

  async initialize(): Promise<void> {
    // First, discover and register bots (this will cache their user IDs)
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
    this.app.post('/slack/events', (req, res) => {
      const botName = this.detectBotFromMessage(req.body);
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
      
      // Get the cached bot user ID for this bot, with fallback mapping
      let botUserId = this.botUserIdCache.get(bot.name);
      
      // Use fallback mapping if cache failed  
      if (!botUserId) {
        const fallbackMapping: Record<string, string> = {
          'binah': 'U090X3GGN93',
          'bina': 'U09EBP618TW'
        };
        botUserId = fallbackMapping[bot.name];
        console.log(`🔄 [WORKFLOW] Using fallback user ID for bot "${bot.name}": ${botUserId || 'NOT FOUND'}`);
      } else {
        console.log(`🔄 [WORKFLOW] Using cached user ID for bot "${bot.name}": ${botUserId}`);
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
        // Add bot context for validation
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