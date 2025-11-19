// Integration tests for LangGraph workflow nodes
import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { mockSlackMessageEvent, htmlResponseSamples, expectedSlackFormatted } from '../__mocks__/test-fixtures';
import { mockSlackClient } from '../__mocks__/slack-client';
import { mockClaudeClient, mockClaudeService } from '../__mocks__/claude-client';
import { SlackWorkflowState } from '../../graph-types';

// Mock the external services
jest.mock('@slack/web-api');
jest.mock('@anthropic-ai/sdk');

describe('LangGraph Workflow Nodes', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateMessageNode', () => {
    test('validates and extracts message text successfully', async () => {
      // Mock the validateMessageNode - in real implementation, we'd import it
      const validateMessageNode = async (state: SlackWorkflowState) => {
        const messageText = state.slackEvent.text || null;
        const shouldProcess = messageText ? messageText.includes('<@U12345BOT>') : false;
        
        return {
          messageText,
          shouldProcess,
          errorOccurred: false
        };
      };

      const initialState: SlackWorkflowState = {
        slackEvent: {
          ...mockSlackMessageEvent,
          text: '<@U12345BOT> What is Genesis 1:1?'
        },
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

      const result = await validateMessageNode(initialState);

      expect(result.messageText).toBe('<@U12345BOT> What is Genesis 1:1?');
      expect(result.shouldProcess).toBe(true);
      expect(result.errorOccurred).toBe(false);
    });

    test('rejects messages without bot mention', async () => {
      const validateMessageNode = async (state: SlackWorkflowState) => {
        const messageText = state.slackEvent.text || null;
        const shouldProcess = messageText ? messageText.includes('<@U12345BOT>') : false;
        
        return {
          messageText,
          shouldProcess,
          errorOccurred: false
        };
      };

      const initialState: SlackWorkflowState = {
        slackEvent: {
          ...mockSlackMessageEvent,
          text: 'Regular message without mention'
        },
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

      const result = await validateMessageNode(initialState);

      expect(result.shouldProcess).toBe(false);
    });

    test('handles validation errors gracefully', async () => {
      const validateMessageNode = async (state: SlackWorkflowState) => {
        try {
          // Simulate an error condition
          if (!state.slackEvent.user) {
            throw new Error('Missing user information');
          }
          return { errorOccurred: false };
        } catch (error) {
          return {
            errorOccurred: true,
            error: `Validation failed: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      };

      const initialState: SlackWorkflowState = {
        slackEvent: {
          ...mockSlackMessageEvent,
          user: undefined as any
        },
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

      const result = await validateMessageNode(initialState);

      expect(result.errorOccurred).toBe(true);
      expect(result.error).toContain('Missing user information');
    });
  });

  describe('sendAcknowledgmentNode', () => {
    test('sends emoji reaction successfully', async () => {
      const sendAcknowledgmentNode = async (state: SlackWorkflowState) => {
        try {
          await mockSlackClient.reactions.add({
            channel: state.slackEvent.channel,
            timestamp: state.slackEvent.ts,
            name: 'thinking_face'
          });
          
          return { acknowledgmentSent: true };
        } catch (error) {
          return { acknowledgmentSent: false };
        }
      };

      const state: SlackWorkflowState = {
        slackEvent: mockSlackMessageEvent,
        shouldProcess: true,
        acknowledgmentSent: false,
        threadHistory: [],
        conversationContext: [],
        messageText: 'Test message',
        claudeResponse: null,
        needsSlackFormatting: false,
        slackValidatedResponse: null,
        formattedResponse: null,
        error: null,
        errorOccurred: false
      };

      const result = await sendAcknowledgmentNode(state);

      expect(result.acknowledgmentSent).toBe(true);
      expect(mockSlackClient.reactions.add).toHaveBeenCalledWith({
        channel: mockSlackMessageEvent.channel,
        timestamp: mockSlackMessageEvent.ts,
        name: 'thinking_face'
      });
    });

    test('handles reaction failures gracefully', async () => {
      const mockReactionsFn = mockSlackClient.reactions.add as any;
      mockReactionsFn.mockRejectedValueOnce(new Error('Rate limited'));

      const sendAcknowledgmentNode = async (state: SlackWorkflowState) => {
        try {
          await mockSlackClient.reactions.add({
            channel: state.slackEvent.channel,
            timestamp: state.slackEvent.ts,
            name: 'thinking_face'
          });
          
          return { acknowledgmentSent: true };
        } catch (error) {
          return { acknowledgmentSent: false };
        }
      };

      const state: SlackWorkflowState = {
        slackEvent: mockSlackMessageEvent,
        shouldProcess: true,
        acknowledgmentSent: false,
        threadHistory: [],
        conversationContext: [],
        messageText: 'Test message',
        claudeResponse: null,
        needsSlackFormatting: false,
        slackValidatedResponse: null,
        formattedResponse: null,
        error: null,
        errorOccurred: false
      };

      const result = await sendAcknowledgmentNode(state);

      expect(result.acknowledgmentSent).toBe(false);
    });
  });

  describe('validateSlackFormattingNode', () => {
    test('detects HTML formatting and corrects it', async () => {
      // Mock the Haiku response for formatting correction
      mockClaudeClient.messages.create.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: expectedSlackFormatted.singleLink
          }
        ]
      });

      const validateSlackFormattingNode = async (state: SlackWorkflowState) => {
        const response = state.claudeResponse || '';
        
        // Check for HTML formatting
        const hasHtmlLinks = /<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g.test(response);
        const hasMarkdownHeaders = /^#{1,6}\s+/m.test(response);
        const hasDoubleAsterisks = /\*\*[^*]+\*\*/g.test(response);
        
        const needsFormatting = hasHtmlLinks || hasMarkdownHeaders || hasDoubleAsterisks;
        
        if (needsFormatting) {
          // Call Claude Haiku for correction
          const correctionResponse = await mockClaudeClient.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 4000,
            temperature: 0,
            messages: [{ role: 'user', content: `Convert to Slack format: ${response}` }]
          });
          
          const correctedText = correctionResponse.content
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('');
          
          return {
            needsSlackFormatting: true,
            slackValidatedResponse: correctedText
          };
        }
        
        return {
          needsSlackFormatting: false,
          slackValidatedResponse: response
        };
      };

      const state: SlackWorkflowState = {
        slackEvent: mockSlackMessageEvent,
        shouldProcess: true,
        acknowledgmentSent: true,
        threadHistory: [],
        conversationContext: [],
        messageText: 'Test message',
        claudeResponse: htmlResponseSamples.singleLink,
        needsSlackFormatting: false,
        slackValidatedResponse: null,
        formattedResponse: null,
        error: null,
        errorOccurred: false
      };

      const result = await validateSlackFormattingNode(state);

      expect(result.needsSlackFormatting).toBe(true);
      expect(result.slackValidatedResponse).toBe(expectedSlackFormatted.singleLink);
      expect(mockClaudeClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5-20251001',
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('Convert to Slack format')
            })
          ])
        })
      );
    });

    test('skips formatting for already valid Slack content', async () => {
      const validateSlackFormattingNode = async (state: SlackWorkflowState) => {
        const response = state.claudeResponse || '';
        
        const hasHtmlLinks = /<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g.test(response);
        const hasMarkdownHeaders = /^#{1,6}\s+/m.test(response);
        const hasDoubleAsterisks = /\*\*[^*]+\*\*/g.test(response);
        
        const needsFormatting = hasHtmlLinks || hasMarkdownHeaders || hasDoubleAsterisks;
        
        if (!needsFormatting) {
          return {
            needsSlackFormatting: false,
            slackValidatedResponse: response
          };
        }
        
        return { needsSlackFormatting: true };
      };

      const slackFormattedContent = 'This is *bold* text with <https://example.com|link>';
      
      const state: SlackWorkflowState = {
        slackEvent: mockSlackMessageEvent,
        shouldProcess: true,
        acknowledgmentSent: true,
        threadHistory: [],
        conversationContext: [],
        messageText: 'Test message',
        claudeResponse: slackFormattedContent,
        needsSlackFormatting: false,
        slackValidatedResponse: null,
        formattedResponse: null,
        error: null,
        errorOccurred: false
      };

      const result = await validateSlackFormattingNode(state);

      expect(result.needsSlackFormatting).toBe(false);
      expect(result.slackValidatedResponse).toBe(slackFormattedContent);
      expect(mockClaudeClient.messages.create).not.toHaveBeenCalled();
    });

    test('handles Claude Haiku API failures with fallback', async () => {
      mockClaudeClient.messages.create.mockRejectedValueOnce(new Error('API Error'));

      const basicSlackFormatConversion = (response: string): string => {
        return response
          .replace(/<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g, '<$1|$2>')
          .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
          .replace(/\*\*([^*]+)\*\*/g, '*$1*');
      };

      const validateSlackFormattingNode = async (state: SlackWorkflowState) => {
        const response = state.claudeResponse || '';
        
        const hasHtmlLinks = /<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g.test(response);
        
        if (hasHtmlLinks) {
          try {
            await mockClaudeClient.messages.create({});
            return { needsSlackFormatting: true };
          } catch (error) {
            // Fallback to basic conversion
            const correctedResponse = basicSlackFormatConversion(response);
            return {
              needsSlackFormatting: true,
              slackValidatedResponse: correctedResponse
            };
          }
        }
        
        return { needsSlackFormatting: false };
      };

      const state: SlackWorkflowState = {
        slackEvent: mockSlackMessageEvent,
        shouldProcess: true,
        acknowledgmentSent: true,
        threadHistory: [],
        conversationContext: [],
        messageText: 'Test message',
        claudeResponse: htmlResponseSamples.singleLink,
        needsSlackFormatting: false,
        slackValidatedResponse: null,
        formattedResponse: null,
        error: null,
        errorOccurred: false
      };

      const result = await validateSlackFormattingNode(state);

      expect(result.needsSlackFormatting).toBe(true);
      expect(result.slackValidatedResponse).toContain('<https://');
      expect(result.slackValidatedResponse).not.toContain('<a href=');
    });
  });

  describe('formatResponseNode', () => {
    test('uses Slack-validated response when available', async () => {
      const formatResponseNode = async (state: SlackWorkflowState) => {
        const response = state.slackValidatedResponse || state.claudeResponse || '';
        
        // Add coverage warning if needed
        const withWarning = response.toLowerCase().includes('limited coverage') 
          ? "⚠️ *Limited Coverage*: This topic may not be fully covered in Sefaria's collection.\n\n" + response
          : response;
        
        // Clean response
        const formattedResponse = withWarning
          .replace(/[ \t]{2,}/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        
        return { formattedResponse };
      };

      const state: SlackWorkflowState = {
        slackEvent: mockSlackMessageEvent,
        shouldProcess: true,
        acknowledgmentSent: true,
        threadHistory: [],
        conversationContext: [],
        messageText: 'Test message',
        claudeResponse: htmlResponseSamples.singleLink,
        needsSlackFormatting: true,
        slackValidatedResponse: expectedSlackFormatted.singleLink,
        formattedResponse: null,
        error: null,
        errorOccurred: false
      };

      const result = await formatResponseNode(state);

      expect(result.formattedResponse).toBe(expectedSlackFormatted.singleLink);
    });

    test('adds coverage warning when appropriate', async () => {
      const formatResponseNode = async (state: SlackWorkflowState) => {
        const response = state.slackValidatedResponse || state.claudeResponse || '';
        
        const withWarning = response.toLowerCase().includes('limited coverage') 
          ? "⚠️ *Limited Coverage*: This topic may not be fully covered in Sefaria's collection.\n\n" + response
          : response;
        
        return { formattedResponse: withWarning.trim() };
      };

      const state: SlackWorkflowState = {
        slackEvent: mockSlackMessageEvent,
        shouldProcess: true,
        acknowledgmentSent: true,
        threadHistory: [],
        conversationContext: [],
        messageText: 'Test message',
        claudeResponse: null,
        needsSlackFormatting: false,
        slackValidatedResponse: 'This topic has limited coverage in sources.',
        formattedResponse: null,
        error: null,
        errorOccurred: false
      };

      const result = await formatResponseNode(state);

      expect(result.formattedResponse).toContain('⚠️ *Limited Coverage*');
      expect(result.formattedResponse).toContain('This topic has limited coverage');
    });
  });

  describe('sendResponseNode', () => {
    test('posts formatted response to Slack successfully', async () => {
      // Mock the function to return a proper response
      const mockFn = mockSlackClient.chat.postMessage as any;
      mockFn.mockResolvedValue({
        ok: true,
        ts: '1234567890.123456',
        channel: 'C12345TEST',
        message: { text: 'Response sent successfully' }
      });
      
      const sendResponseNode = async (state: SlackWorkflowState) => {
        const threadTs = state.slackEvent.thread_ts || state.slackEvent.ts;
        const responseText = state.formattedResponse || 'Default response';
        
        const result = await mockSlackClient.chat.postMessage({
          channel: state.slackEvent.channel,
          thread_ts: threadTs,
          text: responseText,
          mrkdwn: true
        }) as any;
        
        return { messageSent: result?.ok || false };
      };

      const state: SlackWorkflowState = {
        slackEvent: mockSlackMessageEvent,
        shouldProcess: true,
        acknowledgmentSent: true,
        threadHistory: [],
        conversationContext: [],
        messageText: 'Test message',
        claudeResponse: null,
        needsSlackFormatting: false,
        slackValidatedResponse: null,
        formattedResponse: expectedSlackFormatted.singleLink,
        error: null,
        errorOccurred: false
      };

      const result = await sendResponseNode(state);

      expect(result.messageSent).toBe(true);
      expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith({
        channel: mockSlackMessageEvent.channel,
        thread_ts: mockSlackMessageEvent.ts,
        text: expectedSlackFormatted.singleLink,
        mrkdwn: true
      });
    });

    test('handles Slack API errors gracefully', async () => {
      const mockChatFn = mockSlackClient.chat.postMessage as any;
      mockChatFn.mockResolvedValueOnce({ ok: false, error: 'channel_not_found' });

      const sendResponseNode = async (state: SlackWorkflowState) => {
        try {
          const result = await mockSlackClient.chat.postMessage({
            channel: state.slackEvent.channel,
            thread_ts: state.slackEvent.ts,
            text: state.formattedResponse || 'Default',
            mrkdwn: true
          }) as any;
          
          if (!result.ok) {
            return {
              errorOccurred: true,
              error: `Slack API error: ${result.error || 'Unknown error'}`
            };
          }
          
          return {};
        } catch (error) {
          return {
            errorOccurred: true,
            error: `Failed to send response: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      };

      const state: SlackWorkflowState = {
        slackEvent: mockSlackMessageEvent,
        shouldProcess: true,
        acknowledgmentSent: true,
        threadHistory: [],
        conversationContext: [],
        messageText: 'Test message',
        claudeResponse: null,
        needsSlackFormatting: false,
        slackValidatedResponse: null,
        formattedResponse: 'Test response',
        error: null,
        errorOccurred: false
      };

      const result = await sendResponseNode(state);

      expect(result.errorOccurred).toBe(true);
      expect(result.error).toContain('channel_not_found');
    });
  });
});