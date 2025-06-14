import { WebClient } from '@slack/web-api';
import { SlackHandler, SlackMessageEvent, SlackMessage, ConversationMessage, ClaudeService } from './types';

export class SlackHandlerImpl implements SlackHandler {
  private slackClient: WebClient;
  private claudeService: ClaudeService;
  private botUserId: string = '';

  constructor(slackToken: string, claudeService: ClaudeService) {
    this.slackClient = new WebClient(slackToken);
    this.claudeService = claudeService;
    this.initializeBotUser();
  }

  private async initializeBotUser(): Promise<void> {
    try {
      const authResult = await this.slackClient.auth.test();
      this.botUserId = authResult.user_id as string;
    } catch (error) {
      console.error('Failed to get bot user ID:', error);
    }
  }

  async handleMessage(event: SlackMessageEvent): Promise<void> {
    const messageText = this.getMessageText(event);
    console.log(`📥 Processing message: ${messageText?.substring(0, 50)}... (subtype: ${event.subtype || 'none'})`);
    
    try {
      if (!(await this.shouldProcessMessage(event))) {
        return;
      }

      console.log('✅ Processing bot mention');

      // Send immediate acknowledgment
      const ackMessage = await this.sendAcknowledgment(event);

      const threadTs = event.thread_ts || event.ts;
      const threadHistory = await this.getThreadHistory(event.channel, threadTs, event);
      const conversationContext = this.buildConversationContext(threadHistory, ackMessage?.ts);
      
      const response = await this.claudeService.sendMessage(
        conversationContext, 
        process.env.SEFARIA_MCP_URL!
      );

      // Add coverage warning if response indicates limited sources
      const validatedResponse = this.addCoverageWarningIfNeeded(response);

      console.log(`📤 Sending response to thread_ts: ${threadTs}`);
      await this.slackClient.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: this.cleanResponse(validatedResponse),
        mrkdwn: true
      });

      console.log('✅ Response sent successfully');

    } catch (error) {
      console.error('❌ Error handling message:', error);
      console.error('Event details:', { 
        text: messageText?.substring(0, 100), 
        ts: event.ts, 
        thread_ts: event.thread_ts,
        user: event.user,
        subtype: event.subtype
      });
      
      // Only send error message if we haven't already sent a successful response
      const errorThreadTs = event.thread_ts || event.ts;
      console.log(`📤 Sending error message to thread_ts: ${errorThreadTs}`);
      
      // Generate debug message if debug mode is enabled
      const isDebugMode = process.env.DEBUG?.toLowerCase() === 'true';
      let errorMessage = 'Sorry, I encountered an error while processing your request.';
      
      if (isDebugMode) {
        const errorDetails = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : 'No stack trace available';
        errorMessage = `🐛 *Debug Error Details:*\n\n` +
          `*Error:* ${errorDetails}\n\n` +
          `*Event Info:*\n` +
          `• Message: ${messageText?.substring(0, 200) || 'N/A'}\n` +
          `• User: ${event.user || 'N/A'}\n` +
          `• Timestamp: ${event.ts}\n` +
          `• Thread: ${event.thread_ts || 'N/A'}\n` +
          `• Subtype: ${event.subtype || 'none'}\n\n` +
          `*Stack Trace:*\n\`\`\`\n${stack?.substring(0, 1000) || 'N/A'}\n\`\`\``;
      }
      
      try {
        await this.slackClient.chat.postMessage({
          channel: event.channel,
          thread_ts: errorThreadTs,
          text: errorMessage,
          mrkdwn: true
        });
      } catch (errorPostingError) {
        console.error('❌ Failed to post error message:', errorPostingError);
      }
    }
  }

  private async shouldProcessMessage(event: SlackMessageEvent): Promise<boolean> {
    // Skip bot messages
    if (event.bot_id) return false;
    
    // Skip message subtypes we don't want to process (edited messages, etc.)
    if (event.subtype && event.subtype !== 'bot_message') {
      console.log(`❌ Skipping message subtype: ${event.subtype}`);
      return false;
    }
    
    // Skip our own messages
    if (event.user === this.botUserId) return false;
    
    // Get the actual message text (handle different event structures)
    const messageText = this.getMessageText(event);
    if (!messageText) {
      console.log('❌ No message text found');
      return false;
    }
    
    // Only process if app is explicitly mentioned
    return this.isAppMentioned(messageText);
  }

  private async hasBotParticipatedInThread(channel: string, threadTs: string): Promise<boolean> {
    try {
      const result = await this.slackClient.conversations.replies({
        channel,
        ts: threadTs,
        limit: 10
      });

      return (result.messages || []).some(msg => msg.user === this.botUserId || msg.bot_id);
    } catch (error) {
      console.error('Error checking thread participation:', error);
      return false;
    }
  }

  private async sendAcknowledgment(event: SlackMessageEvent): Promise<{ ts: string } | null> {
    try {
      // Determine appropriate emoji based on message type
      const messageText = this.getMessageText(event) || '';
      const emojiName = this.getAcknowledgmentEmoji(messageText);
      
      await this.slackClient.reactions.add({
        channel: event.channel,
        timestamp: event.ts,
        name: emojiName
      });
      return null; // No message timestamp since we're using reactions
    } catch (error) {
      console.error('Error sending acknowledgment:', error);
      return null;
    }
  }

  private getAcknowledgmentEmoji(text: string): string {
    // Simple logic - let Claude handle the nuanced responses
    if (/[\u0590-\u05FF]/.test(text)) {
      return 'scroll'; // 📜 for Hebrew text
    }
    
    return 'thinking_face'; // 🤔 default
  }

  private async getThreadHistory(channel: string, threadTs: string, currentEvent?: SlackMessageEvent): Promise<SlackMessage[]> {
    try {
      const result = await this.slackClient.conversations.replies({
        channel,
        ts: threadTs,
        limit: 5 // Reduced to 5 messages to manage token count
      });

      const messages = (result.messages || []).map(msg => ({
        user: msg.user || '',
        text: msg.text || '',
        ts: msg.ts || '',
        thread_ts: msg.thread_ts,
        bot_id: msg.bot_id
      }));

      // Add current message if it's not already in the thread history
      if (currentEvent && !messages.some(msg => msg.ts === currentEvent.ts)) {
        const currentText = this.getMessageText(currentEvent);
        if (currentText && currentEvent.user) {
          messages.push({
            user: currentEvent.user,
            text: currentText,
            ts: currentEvent.ts,
            thread_ts: currentEvent.thread_ts,
            bot_id: currentEvent.bot_id
          });
        }
      }

      return messages;
    } catch (error) {
      console.error('Error fetching thread history:', error);
      return [];
    }
  }

  private buildConversationContext(messages: SlackMessage[], ackMessageTs?: string): ConversationMessage[] {
    const conversationMessages: ConversationMessage[] = [];

    for (const msg of messages) {
      // Skip empty messages
      if (!msg.text?.trim()) continue;
      
      // Skip acknowledgment messages from being sent to LLM
      if (msg.ts === ackMessageTs || this.isAcknowledgmentMessage(msg.text)) continue;

      const role = msg.bot_id ? 'assistant' : 'user';
      const content = this.cleanMessageText(msg.text);

      // Keep content simple - let Claude analyze intent
      let contextualContent = content;

      // Truncate very long messages to prevent token overflow
      const truncatedContent = contextualContent.length > 2000 ? 
        contextualContent.substring(0, 2000) + '...' : contextualContent;

      conversationMessages.push({ role, content: truncatedContent });
    }

    return conversationMessages;
  }

  private getMessageText(event: SlackMessageEvent): string | null {
    // Handle different event structures
    if (event.text) {
      return event.text;
    }
    
    // For message_changed events, text is in event.message.text
    if (event.message && (event.message as any).text) {
      return (event.message as any).text;
    }
    
    return null;
  }

  private isAppMentioned(text: string): boolean {
    // Only check for proper bot mention using bot user ID
    if (this.botUserId && text.includes(`<@${this.botUserId}>`)) {
      console.log(`✅ Bot mentioned! Bot ID: ${this.botUserId}`);
      return true;
    }
    
    // Debug: show if there are other mentions
    const mentions = text.match(/<@[UW][A-Z0-9]+>/g);
    if (mentions) {
      console.log(`❌ Other mentions found: ${mentions.join(', ')}, but bot ID is ${this.botUserId}`);
    }
    
    // If bot user ID isn't ready yet, don't process any messages
    if (!this.botUserId) {
      console.log('❌ Bot user ID not ready yet');
    }
    
    return false;
  }

  private cleanMessageText(text: string): string {
    // Remove Slack markup and mentions for cleaner conversation
    return text
      .replace(/<@[UW][A-Z0-9]+>/g, '') // Remove user mentions
      .replace(/<#[C][A-Z0-9]+\|([^>]+)>/g, '#$1') // Clean channel mentions
      .replace(/<([^>]+)>/g, '$1') // Remove angle brackets
      .trim();
  }

  private isAcknowledgmentMessage(text: string): boolean {
    return text.includes('I see your message. Working on it...');
  }






  private addCoverageWarningIfNeeded(response: string): string {
    // Only add warning if Claude explicitly mentions limited coverage
    if (response.toLowerCase().includes('limited coverage') || 
        response.toLowerCase().includes('few sources') ||
        response.toLowerCase().includes('not well covered')) {
      return "⚠️ *Limited Coverage*: This topic may not be fully covered in Sefaria's collection.\n\n" + response;
    }
    
    return response;
  }

  private cleanResponse(response: string): string {
    // Minimal post-processing - let Claude handle Slack formatting natively
    return response
      // Only clean up excessive whitespace
      .replace(/[ \t]{2,}/g, ' ') // Multiple spaces/tabs to single space
      .replace(/\n{3,}/g, '\n\n') // More than 2 newlines to 2 newlines
      .trim();
  }
}