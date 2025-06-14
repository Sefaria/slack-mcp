import express from 'express';
import dotenv from 'dotenv';
import { SlackHandlerImpl } from './slack-handler';
import { ClaudeServiceImpl } from './claude-service';
import { Config, SlackMessageEvent } from './types';

dotenv.config();

class SlackMCPApp {
  private app: express.Application;
  private slackHandler: SlackHandlerImpl;
  private config: Config;

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
          console.log('💬 Processing message event:', event);
          // Respond quickly to avoid timeout
          res.status(200).send('OK');
          
          // Process message asynchronously
          this.slackHandler.handleMessage(event as SlackMessageEvent).catch(error => {
            console.error('Error processing message:', error);
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