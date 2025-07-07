// Jest setup file for global configuration
import 'jest';

// Set longer timeout for integration tests
jest.setTimeout(10000);

// Mock environment variables
process.env.SLACK_BOT_TOKEN = 'xoxb-test-token';
process.env.SLACK_SIGNING_SECRET = 'test-signing-secret';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.SEFARIA_MCP_URL = 'http://localhost:3001/test';

// Global test utilities can be added here
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeSlackFormatted(): R;
    }
  }
}

// Custom Jest matcher for Slack formatting validation
expect.extend({
  toBeSlackFormatted(received: string) {
    const hasHtmlTags = /<[^>]+>/g.test(received) && !/<https?:\/\/[^|>]+\|[^>]+>/g.test(received);
    const hasMarkdownHeaders = /^#{1,6}\s+/m.test(received);
    const hasDoubleAsterisks = /\*\*[^*]+\*\*/g.test(received);
    
    const isValid = !hasHtmlTags && !hasMarkdownHeaders && !hasDoubleAsterisks;
    
    if (isValid) {
      return {
        message: () => `Expected ${received} not to be in Slack format`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected ${received} to be in Slack format (no HTML tags, markdown headers, or double asterisks)`,
        pass: false,
      };
    }
  },
});