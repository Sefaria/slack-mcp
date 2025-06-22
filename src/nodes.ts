import { WebClient } from '@slack/web-api';
import { SlackWorkflowState } from './graph-types';
import { SlackHandlerImpl } from './slack-handler';
import { ClaudeServiceImpl } from './claude-service';
import { SlackMessageEvent, ConversationMessage } from './types';
import Anthropic from '@anthropic-ai/sdk';

// Service instances - better to inject these
let slackClient: WebClient;
let claudeService: ClaudeServiceImpl;
let botUserId: string = '';
let haikuClient: Anthropic;

export function initializeServices(
  slackToken: string, 
  anthropicKey: string, 
  mcpUrl: string
) {
  slackClient = new WebClient(slackToken);
  claudeService = new ClaudeServiceImpl(anthropicKey, mcpUrl);
  haikuClient = new Anthropic({ apiKey: anthropicKey });
  
  // Initialize bot user ID
  slackClient.auth.test().then(result => {
    botUserId = result.user_id as string;
    console.log(`🤖 Bot user ID initialized: ${botUserId}`);
  }).catch(error => {
    console.error('Failed to get bot user ID:', error);
  });
}

export async function validateMessageNode(state: SlackWorkflowState): Promise<Partial<SlackWorkflowState>> {
  try {
    console.log('📋 [VALIDATE] Starting validation...');
    console.log('📋 [VALIDATE] Event details:', {
      user: state.slackEvent.user,
      channel: state.slackEvent.channel,
      ts: state.slackEvent.ts,
      bot_id: state.slackEvent.bot_id,
      subtype: state.slackEvent.subtype
    });
    
    // Extract message text
    const messageText = getMessageText(state.slackEvent);
    console.log('📋 [VALIDATE] Extracted message text:', messageText?.substring(0, 200));
    console.log('📋 [VALIDATE] Bot user ID:', botUserId || 'NOT SET');
    
    // Use existing validation logic from SlackHandlerImpl
    const shouldProcess = await shouldProcessMessage(state.slackEvent);
    console.log('📋 [VALIDATE] Should process:', shouldProcess);
    
    const result = {
      messageText,
      shouldProcess,
      errorOccurred: false
    };
    
    console.log('📋 [VALIDATE] Validation result:', result);
    return result;
  } catch (error) {
    console.error('❌ [VALIDATE] Validation error:', error);
    console.error('❌ [VALIDATE] Error stack:', error instanceof Error ? error.stack : 'No stack');
    return {
      errorOccurred: true,
      error: `Validation failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function sendAcknowledgmentNode(state: SlackWorkflowState): Promise<Partial<SlackWorkflowState>> {
  try {
    console.log('👍 [ACK] Starting acknowledgment...');
    console.log('👍 [ACK] Message text for emoji selection:', state.messageText?.substring(0, 100));
    
    // Use existing acknowledgment logic
    console.log('👍 [ACK] About to call getAcknowledgmentEmoji...');
    const emoji = await getAcknowledgmentEmoji(state.messageText || '');
    console.log('👍 [ACK] getAcknowledgmentEmoji returned:', emoji);
    console.log('👍 [ACK] Selected emoji:', emoji);
    console.log('👍 [ACK] Adding reaction to channel:', state.slackEvent.channel, 'ts:', state.slackEvent.ts);
    
    const reaction = await slackClient.reactions.add({
      channel: state.slackEvent.channel,
      timestamp: state.slackEvent.ts,
      name: emoji
    });
    
    console.log('👍 [ACK] Reaction response:', reaction);
    console.log('👍 [ACK] Acknowledgment sent successfully');
    
    return {
      acknowledgmentSent: true
    };
  } catch (error) {
    console.error('❌ [ACK] Acknowledgment error:', error);
    console.error('❌ [ACK] Error details:', {
      channel: state.slackEvent.channel,
      timestamp: state.slackEvent.ts,
      error: error instanceof Error ? error.message : String(error)
    });
    // Non-critical error - continue processing
    return {
      acknowledgmentSent: false
    };
  }
}

export async function fetchContextNode(state: SlackWorkflowState): Promise<Partial<SlackWorkflowState>> {
  try {
    console.log('📚 [CONTEXT] Starting context fetch...');
    
    const threadTs = state.slackEvent.thread_ts || state.slackEvent.ts;
    console.log('📚 [CONTEXT] Thread TS:', threadTs);
    console.log('📚 [CONTEXT] Channel:', state.slackEvent.channel);
    
    // Get thread history using existing logic
    const threadHistory = await getThreadHistory(
      state.slackEvent.channel, 
      threadTs, 
      state.slackEvent
    );
    
    console.log('📚 [CONTEXT] Thread history retrieved:', threadHistory.length, 'messages');
    threadHistory.forEach((msg, i) => {
      console.log(`📚 [CONTEXT] Message ${i}:`, {
        user: msg.user,
        text: msg.text?.substring(0, 100),
        ts: msg.ts,
        bot_id: msg.bot_id
      });
    });
    
    // Build conversation context
    const conversationContext = buildConversationContext(threadHistory);
    console.log('📚 [CONTEXT] Conversation context built:', conversationContext.length, 'messages');
    conversationContext.forEach((msg, i) => {
      console.log(`📚 [CONTEXT] Conversation ${i}:`, {
        role: msg.role,
        content: msg.content.substring(0, 100)
      });
    });
    
    const result = {
      threadHistory,
      conversationContext
    };
    
    console.log('📚 [CONTEXT] Context fetch completed successfully');
    return result;
  } catch (error) {
    console.error('❌ [CONTEXT] Context fetch error:', error);
    console.error('❌ [CONTEXT] Error stack:', error instanceof Error ? error.stack : 'No stack');
    return {
      errorOccurred: true,
      error: `Failed to fetch context: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function callClaudeNode(state: SlackWorkflowState): Promise<Partial<SlackWorkflowState>> {
  try {
    console.log('🤖 [CLAUDE] Starting Claude API call...');
    console.log('🤖 [CLAUDE] Conversation context length:', state.conversationContext?.length || 0);
    console.log('🤖 [CLAUDE] MCP URL:', process.env.SEFARIA_MCP_URL);
    
    if (!state.conversationContext || state.conversationContext.length === 0) {
      console.warn('🤖 [CLAUDE] WARNING: No conversation context provided');
    }
    
    console.log('🤖 [CLAUDE] Sending messages to Claude...');
    const response = await claudeService.sendMessage(
      state.conversationContext || [],
      process.env.SEFARIA_MCP_URL!
    );
    
    console.log('🤖 [CLAUDE] Claude response received');
    console.log('🤖 [CLAUDE] Response type:', typeof response);
    console.log('🤖 [CLAUDE] Response length:', response?.length || 0);
    console.log('🤖 [CLAUDE] Response preview:', response?.substring(0, 200));
    
    if (!response || response.trim().length === 0) {
      console.error('🤖 [CLAUDE] ERROR: Empty response from Claude');
      return {
        errorOccurred: true,
        error: 'Claude returned empty response'
      };
    }
    
    console.log('🤖 [CLAUDE] Claude call completed successfully');
    return {
      claudeResponse: response
    };
  } catch (error) {
    console.error('❌ [CLAUDE] Claude service error:', error);
    console.error('❌ [CLAUDE] Error type:', error?.constructor?.name);
    console.error('❌ [CLAUDE] Error message:', error instanceof Error ? error.message : String(error));
    console.error('❌ [CLAUDE] Error stack:', error instanceof Error ? error.stack : 'No stack');
    
    return {
      errorOccurred: true,
      error: `Claude service failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function formatResponseNode(state: SlackWorkflowState): Promise<Partial<SlackWorkflowState>> {
  try {
    console.log('✨ [FORMAT] Starting response formatting...');
    
    let response = state.claudeResponse || '';
    console.log('✨ [FORMAT] Input response length:', response.length);
    console.log('✨ [FORMAT] Input response preview:', response.substring(0, 200));
    
    if (!response || response.trim().length === 0) {
      console.error('✨ [FORMAT] ERROR: No response to format');
      return {
        errorOccurred: true,
        error: 'No response from Claude to format'
      };
    }
    
    // Add coverage warning if needed
    console.log('✨ [FORMAT] Checking for coverage warnings...');
    const coverageWarning = addCoverageWarningIfNeeded(response);
    console.log('✨ [FORMAT] Coverage warning added:', coverageWarning !== response);
    
    // Clean response for Slack
    console.log('✨ [FORMAT] Cleaning response for Slack...');
    const formattedResponse = cleanResponse(coverageWarning);
    console.log('✨ [FORMAT] Final formatted response length:', formattedResponse.length);
    console.log('✨ [FORMAT] Final formatted response preview:', formattedResponse.substring(0, 200));
    
    console.log('✨ [FORMAT] Response formatting completed successfully');
    return {
      formattedResponse
    };
  } catch (error) {
    console.error('❌ [FORMAT] Formatting error:', error);
    console.error('❌ [FORMAT] Error stack:', error instanceof Error ? error.stack : 'No stack');
    return {
      errorOccurred: true,
      error: `Response formatting failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function sendResponseNode(state: SlackWorkflowState): Promise<Partial<SlackWorkflowState>> {
  try {
    console.log('📤 [SEND] Starting response send...');
    
    const threadTs = state.slackEvent.thread_ts || state.slackEvent.ts;
    const responseText = state.formattedResponse || 'Sorry, I encountered an issue processing your request.';
    
    console.log('📤 [SEND] Thread TS:', threadTs);
    console.log('📤 [SEND] Channel:', state.slackEvent.channel);
    console.log('📤 [SEND] Response text length:', responseText.length);
    console.log('📤 [SEND] Response preview:', responseText.substring(0, 200));
    
    if (!state.formattedResponse) {
      console.warn('📤 [SEND] WARNING: Using fallback message - no formatted response available');
    }
    
    console.log('📤 [SEND] Posting message to Slack...');
    const result = await slackClient.chat.postMessage({
      channel: state.slackEvent.channel,
      thread_ts: threadTs,
      text: responseText,
      mrkdwn: true
    });
    
    console.log('📤 [SEND] Slack API response:', {
      ok: result.ok,
      ts: result.ts,
      channel: result.channel,
      message: result.message ? 'Message object present' : 'No message object'
    });
    
    if (!result.ok) {
      console.error('📤 [SEND] ERROR: Slack API returned not ok');
      return {
        errorOccurred: true,
        error: `Slack API error: ${result.error || 'Unknown error'}`
      };
    }
    
    console.log('✅ [SEND] Response sent successfully');
    return {};
  } catch (error) {
    console.error('❌ [SEND] Send response error:', error);
    console.error('❌ [SEND] Error type:', error?.constructor?.name);
    console.error('❌ [SEND] Error details:', {
      channel: state.slackEvent.channel,
      threadTs: state.slackEvent.thread_ts || state.slackEvent.ts,
      error: error instanceof Error ? error.message : String(error)
    });
    console.error('❌ [SEND] Error stack:', error instanceof Error ? error.stack : 'No stack');
    
    return {
      errorOccurred: true,
      error: `Failed to send response: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function handleErrorNode(state: SlackWorkflowState): Promise<Partial<SlackWorkflowState>> {
  try {
    console.log('🚨 [ERROR] Handling workflow error...');
    console.log('🚨 [ERROR] Error message:', state.error);
    console.log('🚨 [ERROR] Current state:', {
      shouldProcess: state.shouldProcess,
      acknowledgmentSent: state.acknowledgmentSent,
      hasThreadHistory: !!state.threadHistory?.length,
      hasConversationContext: !!state.conversationContext?.length,
      hasClaudeResponse: !!state.claudeResponse,
      hasFormattedResponse: !!state.formattedResponse
    });
    
    const threadTs = state.slackEvent.thread_ts || state.slackEvent.ts;
    const errorMessage = state.error || 'An unexpected error occurred.';
    
    console.log('🚨 [ERROR] Sending error message to Slack...');
    const result = await slackClient.chat.postMessage({
      channel: state.slackEvent.channel,
      thread_ts: threadTs,
      text: `Sorry, I encountered an error: ${errorMessage}`,
      mrkdwn: true
    });
    
    console.log('🚨 [ERROR] Error message sent:', result.ok);
    return {};
  } catch (error) {
    console.error('❌ [ERROR] Error handler failed:', error);
    console.error('❌ [ERROR] Could not send error message to Slack');
    return {};
  }
}

// Helper functions (extracted from existing SlackHandlerImpl)
function getMessageText(event: SlackMessageEvent): string | null {
  if (event.text) return event.text;
  if (event.message && (event.message as any).text) {
    return (event.message as any).text;
  }
  return null;
}

async function shouldProcessMessage(event: SlackMessageEvent): Promise<boolean> {
  if (event.bot_id) return false;
  if (event.subtype && event.subtype !== 'bot_message') return false;
  if (event.user === botUserId) return false; // Skip our own messages
  
  const messageText = getMessageText(event);
  if (!messageText) return false;
  
  // Only process if bot is explicitly mentioned
  if (botUserId && messageText.includes(`<@${botUserId}>`)) {
    console.log(`✅ Bot mentioned! Bot ID: ${botUserId}`);
    return true;
  }
  
  // If bot user ID isn't ready yet, don't process any messages
  if (!botUserId) {
    console.log('❌ Bot user ID not ready yet');
  }
  
  return false;
}

async function getAcknowledgmentEmoji(text: string): Promise<string> {
  console.log('🔥 [DEBUG] getAcknowledgmentEmoji called, haikuClient exists:', !!haikuClient);
  try {
    console.log('👍 [ACK] Starting emoji selection for text:', text.substring(0, 100));
    
    // Get dynamic emoji from Claude Haiku
    const dynamicEmoji = await getDynamicEmoji(text);
    console.log('👍 [ACK] Dynamic emoji result:', dynamicEmoji);
    
    if (dynamicEmoji) {
      console.log('👍 [ACK] Using dynamic emoji:', dynamicEmoji);
      return dynamicEmoji;
    } else {
      console.log('👍 [ACK] No dynamic emoji returned, using fallback logic');
    }
  } catch (error) {
    console.log('👍 [ACK] Dynamic emoji failed, using fallback:', error instanceof Error ? error.message : String(error));
  }
  
  // Fallback to original logic
  if (/[\u0590-\u05FF]/.test(text)) {
    console.log('👍 [ACK] Hebrew text detected, using scroll emoji');
    return 'scroll'; // Hebrew text
  }
  console.log('👍 [ACK] Using default thinking_face emoji');
  return 'thinking_face'; // Default
}

async function getDynamicEmoji(text: string): Promise<string | null> {
  try {
    console.log('🎯 [EMOJI] Requesting dynamic emoji for text:', text.substring(0, 100));
    console.log('🎯 [EMOJI] Haiku client initialized:', !!haikuClient);
    
    const response = await haikuClient.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 10,
      temperature: 0.7,
      messages: [{
        role: 'user',
        content: `Return just a single valid Slack emoji name (without colons) that relates to the TOPIC of this Jewish text question. Be topical and specific. Only use "thinking_face" if the question is specifically about thought, consideration, or contemplation itself: "${text.substring(0, 200)}"`
      }],
      system: 'You are a playful emoji selector for Jewish text discussions. Return ONLY a valid emoji name without colons. Be topical and fun:\n\n- Sabbath questions: candle, star\n- Prayer/worship: pray, raised_hands\n- Torah/study: scroll, books, open_book\n- Talmud/law: balance_scale, memo\n- Ethics/morality: heart, dove_of_peace\n- History: hourglass, classical_building\n- Holidays: tada, sparkles\n- Food/kashrut: cheese, fork_and_knife, herb, bread\n- Marriage/family: ring, house\n- Death/mourning: wilted_flower, broken_heart\n- Philosophy: bulb, question\n- Mysticism: crystal_ball, sparkles\n- Temple: classical_building, fire\n- Money/charity: coin, handshake\n- Countries: flag-ir (Iran), flag-il (Israel), etc.\n- AI/technology: robot_face, computer\n\nBe playful and creative! Examples:\n- Food questions → cheese, bread, wine_glass\n- Iran questions → flag-ir\n- AI questions → robot_face\n- England questions → flag-gb\n\nONLY use thinking_face for questions about thought/contemplation itself.'
    });

    console.log('🎯 [EMOJI] Haiku response content blocks:', response.content.length);
    response.content.forEach((block, index) => {
      console.log(`🎯 [EMOJI] Block ${index}:`, {
        type: block.type,
        text: block.type === 'text' ? block.text : undefined
      });
    });

    const emojiName = response.content[0]?.type === 'text' ? response.content[0].text.trim() : null;
    console.log('🎯 [EMOJI] Extracted emoji name:', JSON.stringify(emojiName));
    
    if (emojiName && isValidEmoji(emojiName)) {
      console.log('🎯 [EMOJI] Emoji validation passed for:', emojiName);
      return emojiName;
    } else {
      console.log('🎯 [EMOJI] Emoji validation failed for:', emojiName, 'isValid:', emojiName ? isValidEmoji(emojiName) : 'null');
    }
    
    return null;
  } catch (error) {
    console.error('🎯 [EMOJI] Failed to get dynamic emoji:', error);
    return null;
  }
}

function isValidEmoji(emojiName: string): boolean {
  // Basic validation - must be alphanumeric with underscores, no colons, reasonable length
  const validPattern = /^[a-z0-9_]+$/;
  return validPattern.test(emojiName) && emojiName.length <= 30 && emojiName.length >= 1;
}

async function getThreadHistory(channel: string, threadTs: string, currentEvent?: SlackMessageEvent) {
  try {
    const result = await slackClient.conversations.replies({
      channel,
      ts: threadTs,
      limit: 5
    });

    const messages = (result.messages || []).map(msg => ({
      user: msg.user || '',
      text: msg.text || '',
      ts: msg.ts || '',
      thread_ts: msg.thread_ts,
      bot_id: msg.bot_id
    }));

    // Add current message if not in history
    if (currentEvent && !messages.some(msg => msg.ts === currentEvent.ts)) {
      const currentText = getMessageText(currentEvent);
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

function buildConversationContext(messages: any[]): ConversationMessage[] {
  const conversationMessages: ConversationMessage[] = [];

  for (const msg of messages) {
    if (!msg.text?.trim()) continue;
    
    const role = msg.bot_id ? 'assistant' : 'user';
    const content = cleanMessageText(msg.text);
    
    const truncatedContent = content.length > 2000 ? 
      content.substring(0, 2000) + '...' : content;

    conversationMessages.push({ role, content: truncatedContent });
  }

  return conversationMessages;
}

function cleanMessageText(text: string): string {
  return text
    .replace(/<@[UW][A-Z0-9]+>/g, '')
    .replace(/<#[C][A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<([^>]+)>/g, '$1')
    .trim();
}

function addCoverageWarningIfNeeded(response: string): string {
  if (response.toLowerCase().includes('limited coverage') || 
      response.toLowerCase().includes('few sources') ||
      response.toLowerCase().includes('not well covered')) {
    return "⚠️ *Limited Coverage*: This topic may not be fully covered in Sefaria's collection.\n\n" + response;
  }
  return response;
}

function cleanResponse(response: string): string {
  return response
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}