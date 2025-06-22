import express from 'express';
import dotenv from 'dotenv';
import { SlackHandlerImpl } from './slack-handler';
import { ClaudeServiceImpl } from './claude-service';
import { Config, SlackMessageEvent } from './types';
import { createSlackWorkflow } from './workflow';
import { initializeServices } from './nodes';

dotenv.config();

class SlackMCPApp {
  private app: express.Application;
  private slackHandler: SlackHandlerImpl;
  private config: Config;
  private workflow: any;

  constructor() {
    this.app = express();
    this.config = this.loadConfig();
    
    const claudeService = new ClaudeServiceImpl(
      this.config.ANTHROPIC_API_KEY,
      this.config.SEFARIA_MCP_URL
    );
    
    this.slackHandler = new SlackHandlerImpl(
      this.config.SLACK_BOT_TOKEN,
      claudeService
    );

    // Initialize LangGraph workflow
    initializeServices(
      this.config.SLACK_BOT_TOKEN,
      this.config.ANTHROPIC_API_KEY,
      this.config.SEFARIA_MCP_URL
    );
    this.workflow = createSlackWorkflow();
  }

  private loadConfig(): Config {
    const requiredEnvVars = [
      'SLACK_BOT_TOKEN',
      'SLACK_SIGNING_SECRET', 
      'ANTHROPIC_API_KEY',
      'SEFARIA_MCP_URL'
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    return {
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN!,
      SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET!,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
      SEFARIA_MCP_URL: process.env.SEFARIA_MCP_URL!,
      PORT: parseInt(process.env.PORT || '3000', 10)
    };
  }

  async initialize(): Promise<void> {
    this.app.use(express.json());
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Slack Events API webhook
    this.app.post('/slack/events', (req, res) => {
      console.log('📨 Received Slack event:', JSON.stringify(req.body, null, 2));
      const { type, event } = req.body;

      try {
        // Handle URL verification challenge
        if (type === 'url_verification') {
          console.log('✅ URL verification challenge received');
          return res.json({ challenge: req.body.challenge });
        }

        // Handle message events
        if (type === 'event_callback' && event?.type === 'message') {
          console.log('💬 Processing message event with LangGraph:', event);
          // Respond quickly to avoid timeout
          res.status(200).send('OK');
          
          // Process message asynchronously using LangGraph workflow
          this.processWithWorkflow(event as SlackMessageEvent).catch(error => {
            console.error('Error processing message with workflow:', error);
          });
          return;
        }

        console.log('ℹ️ Unhandled event type:', type, event?.type);
        res.status(200).send('OK');
      } catch (error) {
        console.error('Error processing Slack event:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }

  private async processWithWorkflow(event: SlackMessageEvent): Promise<void> {
    try {
      console.log('🔄 [WORKFLOW] Starting LangGraph workflow...');
      console.log('🔄 [WORKFLOW] Event summary:', {
        user: event.user,
        channel: event.channel,
        ts: event.ts,
        thread_ts: event.thread_ts,
        text_preview: event.text?.substring(0, 100)
      });
      
      const initialState = {
        slackEvent: event,
        shouldProcess: false,
        acknowledgmentSent: false,
        threadHistory: [],
        conversationContext: [],
        messageText: null,
        claudeResponse: null,
        formattedResponse: null,
        error: null,
        errorOccurred: false
      };

      console.log('🔄 [WORKFLOW] Initial state created, invoking workflow...');
      const result = await this.workflow.invoke(initialState);
      
      console.log('✅ [WORKFLOW] Workflow completed successfully');
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
      console.error('❌ [WORKFLOW] Workflow execution failed:', error);
      console.error('❌ [WORKFLOW] Error type:', error?.constructor?.name);
      console.error('❌ [WORKFLOW] Error message:', error instanceof Error ? error.message : String(error));
      console.error('❌ [WORKFLOW] Error stack:', error instanceof Error ? error.stack : 'No stack');
      
      // Fallback to original handler for critical failures
      console.log('🔄 [WORKFLOW] Falling back to original handler...');
      try {
        await this.slackHandler.handleMessage(event);
        console.log('✅ [WORKFLOW] Fallback handler completed successfully');
      } catch (fallbackError) {
        console.error('❌ [WORKFLOW] Fallback handler also failed:', fallbackError);
      }
    }
  }

  async start(port: number = this.config.PORT): Promise<void> {
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