import { SlackWorkflowState } from './graph-types';

export interface BotConfig {
  name: string;
  slackToken: string;
  signingSecret: string;
  workflowFactory: () => any;
  description?: string;
}

export class BotRegistry {
  private bots = new Map<string, BotConfig>();

  registerBot(config: BotConfig): void {
    console.log(`🤖 Registering bot: ${config.name}`);
    this.bots.set(config.name, config);
  }

  getBot(name: string): BotConfig | undefined {
    return this.bots.get(name);
  }

  listBots(): string[] {
    return Array.from(this.bots.keys());
  }

  getAllBots(): BotConfig[] {
    return Array.from(this.bots.values());
  }

  hasBot(name: string): boolean {
    return this.bots.has(name);
  }

  getBotCount(): number {
    return this.bots.size;
  }
}

// Singleton instance
export const botRegistry = new BotRegistry();