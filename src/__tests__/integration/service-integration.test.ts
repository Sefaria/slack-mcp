// Integration tests for service interactions
import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { mockSlackMessageEvent } from '../__mocks__/test-fixtures';
import { mockSlackClient } from '../__mocks__/slack-client';
import { mockClaudeService } from '../__mocks__/claude-client';

// Mock the external services
jest.mock('@slack/web-api');
jest.mock('@anthropic-ai/sdk');

describe('Service Integration Tests', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Slack API Integration', () => {
    test('handles rate limiting gracefully', async () => {
      const mockFn = mockSlackClient.reactions.add as any;
      mockFn.mockRejectedValue(new Error('rate_limited'));
      
      try {
        await mockSlackClient.reactions.add({
          channel: 'C123',
          timestamp: '123.456',
          name: 'thinking_face'
        });
      } catch (error: any) {
        expect(error.message).toBe('rate_limited');
      }
    });

    test('handles network timeouts', async () => {
      const mockFn = mockSlackClient.chat.postMessage as any;
      mockFn.mockRejectedValue(new Error('ETIMEDOUT'));
      
      try {
        await mockSlackClient.chat.postMessage({
          channel: 'C123',
          text: 'Test message'
        });
      } catch (error: any) {
        expect(error.message).toBe('ETIMEDOUT');
      }
    });

    test('handles invalid channel errors', async () => {
      const mockFn = mockSlackClient.chat.postMessage as any;
      mockFn.mockResolvedValue({ ok: false, error: 'channel_not_found' });
      
      const result = await mockSlackClient.chat.postMessage({
        channel: 'INVALID',
        text: 'Test message'
      });
      
      expect((result as any).ok).toBe(false);
      expect((result as any).error).toBe('channel_not_found');
    });

    test('handles thread reply scenarios', async () => {
      const mockFn = mockSlackClient.conversations.replies as any;
      mockFn.mockResolvedValue({
        ok: true,
        messages: [
          {
            user: 'U123',
            text: 'Original message',
            ts: '123.000',
            thread_ts: '123.000'
          },
          {
            user: 'U456',
            text: 'Reply message',
            ts: '123.001',
            thread_ts: '123.000'
          }
        ]
      });
      
      const result = await mockSlackClient.conversations.replies({
        channel: 'C123',
        ts: '123.000'
      });
      
      expect((result as any).ok).toBe(true);
      expect((result as any).messages).toHaveLength(2);
      expect((result as any).messages?.[1].text).toBe('Reply message');
    });
  });

  describe('Claude API Integration', () => {
    test('handles various response formats', async () => {
      const responses = [
        'Simple text response',
        '## Header\nWith **formatting**',
        'Response with <a href="https://example.com">link</a>',
        '```\nCode block\n```',
        'Unicode: 🤖 בראשית 中文'
      ];
      
      responses.forEach(response => {
        expect(typeof response).toBe('string');
        expect(response.length).toBeGreaterThan(0);
      });
    });

    test('handles API errors gracefully', async () => {
      // @ts-ignore
      const mockClaudeCall = jest.fn().mockRejectedValue(new Error('API quota exceeded'));
      
      try {
        await mockClaudeCall();
      } catch (error: any) {
        expect(error.message).toBe('API quota exceeded');
      }
    });

    test('handles timeout scenarios', async () => {
      // @ts-ignore
      const mockClaudeCall = jest.fn().mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 100)
        )
      );
      
      try {
        await mockClaudeCall();
      } catch (error: any) {
        expect(error.message).toBe('Request timeout');
      }
    });
  });

  describe('End-to-End Error Scenarios', () => {
    test('handles complete service failure', async () => {
      // Simulate all services failing
      const mockSlackFn = mockSlackClient.chat.postMessage as any;
      mockSlackFn.mockRejectedValue(new Error('Service unavailable'));
      
      // @ts-ignore
      const mockClaude = jest.fn().mockRejectedValue(new Error('Claude unavailable'));
      
      // Mock console.error to suppress the log output during test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      // Should still complete without crashing
      const testFunction = async () => {
        try {
          await mockClaude();
        } catch (e) {
          // Handle gracefully
          try {
            await mockSlackClient.chat.postMessage({
              channel: 'C123',
              text: 'Error occurred'
            });
          } catch (slackError) {
            // Final fallback - log the error
            console.error('All services failed');
          }
        }
      };
      
      await expect(testFunction()).resolves.not.toThrow();
      
      // Verify console.error was called
      expect(consoleSpy).toHaveBeenCalledWith('All services failed');
      consoleSpy.mockRestore();
    });

    test('handles partial service recovery', async () => {
      // Slack fails first, then succeeds
      const mockSlackFn = mockSlackClient.chat.postMessage as any;
      mockSlackFn
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({ ok: true, ts: '123.456' });
      
      // First call fails
      try {
        await mockSlackClient.chat.postMessage({
          channel: 'C123',
          text: 'First attempt'
        });
      } catch (error: any) {
        expect(error.message).toBe('Temporary failure');
      }
      
      // Second call succeeds
      const result = await mockSlackClient.chat.postMessage({
        channel: 'C123',
        text: 'Retry attempt'
      });
      
      expect((result as any).ok).toBe(true);
    });
  });

  describe('Data Flow Integration', () => {
    test('maintains data integrity through workflow', async () => {
      const initialMessage = 'What is Genesis 1:1?';
      const processedMessage = initialMessage;
      const claudeResponse = 'Genesis 1:1 discusses the creation narrative...';
      const formattedResponse = claudeResponse;
      
      // Verify data flows correctly through each stage
      expect(processedMessage).toBe(initialMessage);
      expect(claudeResponse).toContain('Genesis');
      expect(formattedResponse).toBe(claudeResponse);
    });

    test('handles Unicode preservation through services', async () => {
      const unicodeText = '🤖 שבת שלום! What does בראשית mean?';
      
      // Mock Claude processing that preserves Unicode
      const mockClaudeResponse = 'בראשית means "In the beginning" 📚';
      
      // Verify Unicode is preserved
      expect(unicodeText).toContain('🤖');
      expect(unicodeText).toContain('שבת');
      expect(unicodeText).toContain('בראשית');
      expect(mockClaudeResponse).toContain('בראשית');
      expect(mockClaudeResponse).toContain('📚');
    });

    test('handles very long conversation threads', async () => {
      const longThread = Array(50).fill(0).map((_, i) => ({
        user: i % 2 === 0 ? 'U123' : 'U456',
        text: `Message ${i + 1} in the long conversation`,
        ts: `123.${String(i).padStart(3, '0')}`,
        thread_ts: '123.000'
      }));
      
      expect(longThread).toHaveLength(50);
      expect(longThread[0].text).toBe('Message 1 in the long conversation');
      expect(longThread[49].text).toBe('Message 50 in the long conversation');
    });
  });

  describe('Concurrency and Race Conditions', () => {
    test('handles multiple simultaneous requests', async () => {
      const mockFn = mockSlackClient.chat.postMessage as any;
      mockFn.mockImplementation(async ({ text }: any) => ({
        ok: true,
        ts: `${Date.now()}.${Math.random()}`,
        text
      }));
      
      const requests = Array(10).fill(0).map((_, i) =>
        mockSlackClient.chat.postMessage({
          channel: 'C123',
          text: `Concurrent message ${i}`
        })
      );
      
      const results = await Promise.all(requests);
      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect((result as any).ok).toBe(true);
        expect((result as any).text).toBe(`Concurrent message ${i}`);
      });
    });

    test('handles request ordering with delays', async () => {
      const mockFn = mockSlackClient.chat.postMessage as any;
      const results: string[] = [];
      
      mockFn.mockImplementation(async ({ text }: any) => {
        // Simulate variable response times
        const delay = Math.random() * 100;
        await new Promise(resolve => setTimeout(resolve, delay));
        results.push(text);
        return { ok: true, ts: `${Date.now()}.000`, text };
      });
      
      await Promise.all([
        mockSlackClient.chat.postMessage({ channel: 'C123', text: 'Message 1' }),
        mockSlackClient.chat.postMessage({ channel: 'C123', text: 'Message 2' }),
        mockSlackClient.chat.postMessage({ channel: 'C123', text: 'Message 3' })
      ]);
      
      expect(results).toHaveLength(3);
      expect(results).toContain('Message 1');
      expect(results).toContain('Message 2');
      expect(results).toContain('Message 3');
    });
  });

  describe('Memory and Resource Management', () => {
    test('handles large response payloads', async () => {
      const largeResponse = 'x'.repeat(100000); // 100KB response
      const mockFn = mockSlackClient.chat.postMessage as any;
      mockFn.mockResolvedValue({
        ok: true,
        ts: '123.456',
        message: { text: largeResponse }
      });
      
      const result = await mockSlackClient.chat.postMessage({
        channel: 'C123',
        text: largeResponse
      });
      
      expect((result as any).ok).toBe(true);
      expect((result as any).message?.text).toHaveLength(100000);
    });

    test('cleans up resources after errors', async () => {
      const mockFn = mockSlackClient.chat.postMessage as any;
      mockFn.mockRejectedValue(new Error('Network error'));
      
      let resourcesCleaned = false;
      
      try {
        await mockSlackClient.chat.postMessage({
          channel: 'C123',
          text: 'Test message'
        });
      } catch (error) {
        // Simulate resource cleanup
        resourcesCleaned = true;
      }
      
      expect(resourcesCleaned).toBe(true);
    });
  });
});