// Mock Anthropic Claude client for testing
export const mockClaudeClient = {
  messages: {
    create: jest.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'This is a test response from Claude'
        }
      ]
    })
  }
};

// Mock Claude service
export const mockClaudeService = {
  sendMessage: jest.fn().mockResolvedValue('Mock Claude response')
};

// Mock the @anthropic-ai/sdk module
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => mockClaudeClient);
});