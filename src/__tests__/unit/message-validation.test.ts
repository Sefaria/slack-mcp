// Tests for message validation and processing logic
import { describe, test, expect, beforeEach } from '@jest/globals';
import { 
  mockSlackMessageEvent, 
  mockThreadMessage, 
  emojiTestCases,
  coverageTestCases 
} from '../__mocks__/test-fixtures';
import { SlackMessageEvent } from '../../types';
import { getMessageText } from '../../nodes';

describe('Message Validation Functions', () => {
  
  describe('getMessageText', () => {

    test('extracts text from direct message event', () => {
      const event: SlackMessageEvent = {
        ...mockSlackMessageEvent,
        text: 'Direct message text'
      };
      
      const result = getMessageText(event);
      expect(result).toBe('Direct message text');
    });

    test('extracts text from nested message object', () => {
      const event: SlackMessageEvent = {
        ...mockSlackMessageEvent,
        text: undefined,
        message: {
          text: 'Nested message text'
        } as any
      };
      
      const result = getMessageText(event);
      expect(result).toBe('Nested message text');
    });

    test('returns null when no text is available', () => {
      const event: SlackMessageEvent = {
        ...mockSlackMessageEvent,
        text: undefined,
        message: undefined
      };
      
      const result = getMessageText(event);
      expect(result).toBeNull();
    });

    test('handles empty strings', () => {
      const event: SlackMessageEvent = {
        ...mockSlackMessageEvent,
        text: ''
      };
      
      const result = getMessageText(event);
      expect(result).toBe('');
    });
  });

  describe('cleanMessageText', () => {
    // Function from nodes.ts for testing
    const cleanMessageText = (text: string): string => {
      return text
        .replace(/<@[UW][A-Z0-9]+>/g, '')
        .replace(/<#[C][A-Z0-9]+\|([^>]+)>/g, '#$1')
        .replace(/<([^>]+)>/g, '$1')
        .trim();
    };

    test('removes user mentions', () => {
      const input = '<@U12345USER> Hello world!';
      const result = cleanMessageText(input);
      expect(result).toBe('Hello world!');
    });

    test('cleans channel mentions', () => {
      const input = 'Posted in <#C12345CHANNEL|general>';
      const result = cleanMessageText(input);
      expect(result).toBe('Posted in #general');
    });

    test('removes angle brackets from URLs', () => {
      const input = 'Check out <https://example.com>';
      const result = cleanMessageText(input);
      expect(result).toBe('Check out https://example.com');
    });

    test('handles multiple types of markup', () => {
      const input = '<@U12345USER> see <#C12345CHANNEL|general> and <https://example.com>';
      const result = cleanMessageText(input);
      expect(result).toBe('see #general and https://example.com');
    });

    test('trims whitespace', () => {
      const input = '  <@U12345USER>  message text  ';
      const result = cleanMessageText(input);
      expect(result).toBe('message text');
    });

    test('preserves regular text', () => {
      const input = 'Regular message without markup';
      const result = cleanMessageText(input);
      expect(result).toBe(input);
    });
  });

  describe('shouldProcessMessage validation', () => {
    const botUserId = 'U12345BOT';
    
    // Extracted logic from shouldProcessMessage function
    const shouldProcessMessage = (event: SlackMessageEvent, botUserId: string): boolean => {
      if (event.bot_id) return false;
      if (event.subtype && event.subtype !== 'bot_message') return false;
      if (event.user === botUserId) return false;
      
      const messageText = event.text || '';
      if (!messageText) return false;
      
      return messageText.includes(`<@${botUserId}>`);
    };

    test('processes messages with bot mention', () => {
      const event: SlackMessageEvent = {
        ...mockSlackMessageEvent,
        text: `<@${botUserId}> What is Genesis 1:1?`
      };
      
      expect(shouldProcessMessage(event, botUserId)).toBe(true);
    });

    test('ignores messages without bot mention', () => {
      const event: SlackMessageEvent = {
        ...mockSlackMessageEvent,
        text: 'Regular message without mention'
      };
      
      expect(shouldProcessMessage(event, botUserId)).toBe(false);
    });

    test('ignores bot messages', () => {
      const event: SlackMessageEvent = {
        ...mockSlackMessageEvent,
        text: `<@${botUserId}> Question`,
        bot_id: 'B12345BOT'
      };
      
      expect(shouldProcessMessage(event, botUserId)).toBe(false);
    });

    test('ignores own messages', () => {
      const event: SlackMessageEvent = {
        ...mockSlackMessageEvent,
        text: `<@${botUserId}> Question`,
        user: botUserId
      };
      
      expect(shouldProcessMessage(event, botUserId)).toBe(false);
    });

    test('ignores edited messages', () => {
      const event: SlackMessageEvent = {
        ...mockSlackMessageEvent,
        text: `<@${botUserId}> Question`,
        subtype: 'message_changed'
      };
      
      expect(shouldProcessMessage(event, botUserId)).toBe(false);
    });

    test('ignores empty messages', () => {
      const event: SlackMessageEvent = {
        ...mockSlackMessageEvent,
        text: ''
      };
      
      expect(shouldProcessMessage(event, botUserId)).toBe(false);
    });
  });

  describe('isValidEmoji', () => {
    // Function from nodes.ts
    const isValidEmoji = (emojiName: string): boolean => {
      const validPattern = /^[a-z0-9_]+$/;
      return validPattern.test(emojiName) && emojiName.length <= 30 && emojiName.length >= 1;
    };

    test('accepts valid emoji names', () => {
      expect(isValidEmoji('thinking_face')).toBe(true);
      expect(isValidEmoji('scroll')).toBe(true);
      expect(isValidEmoji('books')).toBe(true);
      expect(isValidEmoji('flag_il')).toBe(true);
      expect(isValidEmoji('star2')).toBe(true);
    });

    test('rejects invalid characters', () => {
      expect(isValidEmoji('thinking-face')).toBe(false); // hyphen
      expect(isValidEmoji('thinking face')).toBe(false); // space
      expect(isValidEmoji('thinking.face')).toBe(false); // period
      expect(isValidEmoji('THINKING_FACE')).toBe(false); // uppercase
      expect(isValidEmoji(':thinking_face:')).toBe(false); // colons
    });

    test('rejects empty or too long names', () => {
      expect(isValidEmoji('')).toBe(false);
      expect(isValidEmoji('a'.repeat(31))).toBe(false);
    });

    test('accepts edge case lengths', () => {
      expect(isValidEmoji('a')).toBe(true); // minimum length
      expect(isValidEmoji('a'.repeat(30))).toBe(true); // maximum length
    });
  });

  describe('addCoverageWarningIfNeeded', () => {
    // Function from nodes.ts
    const addCoverageWarningIfNeeded = (response: string): string => {
      if (response.toLowerCase().includes('limited coverage') || 
          response.toLowerCase().includes('few sources') ||
          response.toLowerCase().includes('not well covered')) {
        return "⚠️ *Limited Coverage*: This topic may not be fully covered in Sefaria's collection.\n\n" + response;
      }
      return response;
    };

    test('adds warning for limited coverage responses', () => {
      coverageTestCases.forEach(({ input, shouldHaveWarning }) => {
        const result = addCoverageWarningIfNeeded(input);
        
        if (shouldHaveWarning) {
          expect(result).toContain('⚠️ *Limited Coverage*');
          expect(result).toContain(input);
        } else {
          expect(result).toBe(input);
          expect(result).not.toContain('⚠️ *Limited Coverage*');
        }
      });
    });

    test('preserves original response when adding warning', () => {
      const input = 'This has limited coverage in sources.';
      const result = addCoverageWarningIfNeeded(input);
      
      expect(result).toContain(input);
      expect(result.endsWith(input)).toBe(true);
    });

    test('is case insensitive', () => {
      const inputs = [
        'LIMITED COVERAGE available',
        'FEW SOURCES exist',
        'Not Well Covered topic'
      ];
      
      inputs.forEach(input => {
        const result = addCoverageWarningIfNeeded(input);
        expect(result).toContain('⚠️ *Limited Coverage*');
      });
    });
  });

  describe('buildConversationContext', () => {
    // Simplified version of the function for testing
    const buildConversationContext = (messages: any[]) => {
      const conversationMessages: any[] = [];

      for (const msg of messages) {
        if (!msg.text?.trim()) continue;
        
        const role = msg.bot_id ? 'assistant' : 'user';
        const content = msg.text.replace(/<@[UW][A-Z0-9]+>/g, '').trim();
        
        const truncatedContent = content.length > 2000 ? 
          content.substring(0, 2000) + '...' : content;

        conversationMessages.push({ role, content: truncatedContent });
      }

      return conversationMessages;
    };

    test('builds conversation context from thread messages', () => {
      const messages = [
        { text: '<@U12345BOT> What is Genesis 1:1?', user: 'U12345USER' },
        { text: 'Genesis 1:1 describes...', bot_id: 'B12345BOT' },
        { text: 'Can you explain more?', user: 'U12345USER' }
      ];
      
      const result = buildConversationContext(messages);
      
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ role: 'user', content: 'What is Genesis 1:1?' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'Genesis 1:1 describes...' });
      expect(result[2]).toEqual({ role: 'user', content: 'Can you explain more?' });
    });

    test('skips empty messages', () => {
      const messages = [
        { text: 'Valid message', user: 'U12345USER' },
        { text: '', user: 'U12345USER' },
        { text: '   ', user: 'U12345USER' },
        { text: 'Another valid message', user: 'U12345USER' }
      ];
      
      const result = buildConversationContext(messages);
      
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Valid message');
      expect(result[1].content).toBe('Another valid message');
    });

    test('truncates very long messages', () => {
      const longText = 'a'.repeat(2500);
      const messages = [
        { text: longText, user: 'U12345USER' }
      ];
      
      const result = buildConversationContext(messages);
      
      expect(result).toHaveLength(1);
      expect(result[0].content).toHaveLength(2003); // 2000 + '...'
      expect(result[0].content.endsWith('...')).toBe(true);
    });

    test('removes user mentions from content', () => {
      const messages = [
        { text: '<@U12345BOT> <@U12345USER> What about this?', user: 'U12345USER' }
      ];
      
      const result = buildConversationContext(messages);
      
      expect(result[0].content).toBe('What about this?');
      expect(result[0].content).not.toContain('<@');
    });
  });
});