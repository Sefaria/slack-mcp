// Mock Slack WebClient for testing
import { jest } from '@jest/globals';

// @ts-ignore
const createMockFn = (returnValue: any) => jest.fn().mockResolvedValue(returnValue);

export const mockSlackClient = {
  auth: {
    test: createMockFn({
      ok: true,
      user_id: 'U12345TEST',
      team_id: 'T12345TEST'
    })
  },
  
  reactions: {
    add: createMockFn({
      ok: true
    })
  },
  
  conversations: {
    replies: createMockFn({
      ok: true,
      messages: [
        {
          user: 'U12345USER',
          text: 'Test message',
          ts: '1234567890.123456',
          thread_ts: '1234567890.123456'
        }
      ]
    })
  },
  
  chat: {
    postMessage: createMockFn({
      ok: true,
      ts: '1234567890.123456',
      channel: 'C12345TEST',
      message: {
        text: 'Response sent successfully'
      }
    })
  }
};

// Mock the @slack/web-api module
jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => mockSlackClient)
}));