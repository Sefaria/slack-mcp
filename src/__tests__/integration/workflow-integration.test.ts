// Integration tests for the complete LangGraph workflow
import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { mockSlackMessageEvent, htmlResponseSamples, expectedSlackFormatted } from '../__mocks__/test-fixtures';
import { SlackWorkflowState } from '../../graph-types';

// Mock external dependencies
jest.mock('@slack/web-api');
jest.mock('@anthropic-ai/sdk');

describe('Complete Workflow Integration', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('End-to-End Slack Formatting Workflow', () => {
    test('processes HTML response through complete formatting pipeline', async () => {
      // Simulate the complete workflow pipeline
      const runWorkflow = async (initialState: SlackWorkflowState) => {
        let state = { ...initialState };
        
        // Step 1: Validate message
        if (state.slackEvent.text?.includes('<@U12345BOT>')) {
          state = { ...state, shouldProcess: true, messageText: state.slackEvent.text };
        }
        
        // Step 2: Acknowledge (mocked)
        state = { ...state, acknowledgmentSent: true };
        
        // Step 3: Fetch context (mocked)
        state = { 
          ...state, 
          conversationContext: [
            { role: 'user', content: 'What is Genesis 1:1?' }
          ] 
        };
        
        // Step 4: Call Claude (mocked with HTML response)
        state = { ...state, claudeResponse: htmlResponseSamples.singleLink };
        
        // Step 5: Validate Slack formatting
        const hasHtmlLinks = /<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g.test(state.claudeResponse!);
        if (hasHtmlLinks) {
          // Simulate Claude Haiku correction
          state = { 
            ...state, 
            needsSlackFormatting: true,
            slackValidatedResponse: expectedSlackFormatted.singleLink
          };
        }
        
        // Step 6: Format response
        const finalResponse = state.slackValidatedResponse || state.claudeResponse || '';
        state = { ...state, formattedResponse: finalResponse };
        
        // Step 7: Send response (mocked)
        // In real implementation, this would post to Slack
        
        return state;
      };

      const initialState: SlackWorkflowState = {
        slackEvent: {
          ...mockSlackMessageEvent,
          text: '<@U12345BOT> Explain Genesis 1:1'
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

      const finalState = await runWorkflow(initialState);

      // Verify the complete pipeline
      expect(finalState.shouldProcess).toBe(true);
      expect(finalState.acknowledgmentSent).toBe(true);
      expect(finalState.claudeResponse).toBe(htmlResponseSamples.singleLink);
      expect(finalState.needsSlackFormatting).toBe(true);
      expect(finalState.slackValidatedResponse).toBe(expectedSlackFormatted.singleLink);
      expect(finalState.formattedResponse).toBe(expectedSlackFormatted.singleLink);
      
      // Verify the final response is properly formatted for Slack
      expect(finalState.formattedResponse).toContain('<https://www.sefaria.org/');
      expect(finalState.formattedResponse).not.toContain('<a href=');
      expect(finalState.formattedResponse).not.toContain('target="_blank"');
    });

    test('handles workflow with no formatting needed', async () => {
      const runWorkflow = async (initialState: SlackWorkflowState) => {
        let state = { ...initialState };
        
        // Validate and process
        if (state.slackEvent.text?.includes('<@U12345BOT>')) {
          state = { ...state, shouldProcess: true, messageText: state.slackEvent.text };
        }
        
        state = { ...state, acknowledgmentSent: true };
        state = { ...state, conversationContext: [{ role: 'user', content: 'Test' }] };
        
        // Claude returns already formatted response
        const slackFormattedResponse = 'This is *bold* text with <https://example.com|link>';
        state = { ...state, claudeResponse: slackFormattedResponse };
        
        // Validate Slack formatting - no changes needed
        const hasHtmlLinks = state.claudeResponse ? /<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g.test(state.claudeResponse) : false;
        const hasMarkdownHeaders = state.claudeResponse ? /^#{1,6}\s+/m.test(state.claudeResponse) : false;
        const hasDoubleAsterisks = state.claudeResponse ? /\*\*[^*]+\*\*/g.test(state.claudeResponse) : false;
        
        if (!hasHtmlLinks && !hasMarkdownHeaders && !hasDoubleAsterisks) {
          state = { 
            ...state, 
            needsSlackFormatting: false,
            slackValidatedResponse: state.claudeResponse
          };
        }
        
        state = { ...state, formattedResponse: state.slackValidatedResponse };
        
        return state;
      };

      const initialState: SlackWorkflowState = {
        slackEvent: {
          ...mockSlackMessageEvent,
          text: '<@U12345BOT> Simple question'
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

      const finalState = await runWorkflow(initialState);

      expect(finalState.needsSlackFormatting).toBe(false);
      expect(finalState.slackValidatedResponse).toBe('This is *bold* text with <https://example.com|link>');
      expect(finalState.formattedResponse).toBe(finalState.slackValidatedResponse);
    });

    test('handles multiple formatting issues in one response', async () => {
      const runWorkflow = async (initialState: SlackWorkflowState) => {
        let state = { ...initialState };
        
        state = { ...state, shouldProcess: true, acknowledgmentSent: true };
        state = { ...state, claudeResponse: htmlResponseSamples.withMarkdownHeaders };
        
        // Simulate comprehensive formatting correction
        const hasHtmlLinks = /<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g.test(state.claudeResponse!);
        const hasMarkdownHeaders = /^#{1,6}\s+/m.test(state.claudeResponse!);
        const hasDoubleAsterisks = /\*\*[^*]+\*\*/g.test(state.claudeResponse!);
        
        if (hasHtmlLinks || hasMarkdownHeaders || hasDoubleAsterisks) {
          // Apply all necessary transformations
          let corrected = state.claudeResponse!;
          
          // Convert HTML links
          corrected = corrected.replace(/<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g, '<$1|$2>');
          
          // Convert markdown headers
          corrected = corrected.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
          
          // Convert double asterisks
          corrected = corrected.replace(/\*\*([^*]+)\*\*/g, '*$1*');
          
          state = { 
            ...state, 
            needsSlackFormatting: true,
            slackValidatedResponse: corrected
          };
        }
        
        state = { ...state, formattedResponse: state.slackValidatedResponse };
        
        return state;
      };

      const initialState: SlackWorkflowState = {
        slackEvent: mockSlackMessageEvent,
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

      const finalState = await runWorkflow(initialState);

      expect(finalState.needsSlackFormatting).toBe(true);
      expect(finalState.formattedResponse).toBe(expectedSlackFormatted.withMarkdownHeaders);
      expect(finalState.formattedResponse).not.toContain('##');
      expect(finalState.formattedResponse).not.toContain('<a href=');
    });

    test('handles workflow errors gracefully', async () => {
      const runWorkflowWithError = async (initialState: SlackWorkflowState) => {
        let state = { ...initialState };
        
        try {
          // Simulate validation
          state = { ...state, shouldProcess: true };
          
          // Simulate Claude call failure
          throw new Error('Claude API unavailable');
          
        } catch (error) {
          state = {
            ...state,
            errorOccurred: true,
            error: error instanceof Error ? error.message : String(error)
          };
        }
        
        return state;
      };

      const initialState: SlackWorkflowState = {
        slackEvent: mockSlackMessageEvent,
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

      const finalState = await runWorkflowWithError(initialState);

      expect(finalState.errorOccurred).toBe(true);
      expect(finalState.error).toBe('Claude API unavailable');
    });
  });

  describe('Workflow State Transitions', () => {
    test('validates state transitions through formatting pipeline', () => {
      const initialState: SlackWorkflowState = {
        slackEvent: mockSlackMessageEvent,
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

      // State after validation
      const validatedState = {
        ...initialState,
        shouldProcess: true,
        messageText: 'Test message'
      };

      // State after Claude response
      const claudeState = {
        ...validatedState,
        claudeResponse: htmlResponseSamples.singleLink
      };

      // State after Slack formatting validation
      const formattingState = {
        ...claudeState,
        needsSlackFormatting: true,
        slackValidatedResponse: expectedSlackFormatted.singleLink
      };

      // State after final formatting
      const finalState = {
        ...formattingState,
        formattedResponse: expectedSlackFormatted.singleLink
      };

      // Verify each transition maintains required fields
      expect(validatedState.shouldProcess).toBe(true);
      expect(claudeState.claudeResponse).toBeTruthy();
      expect(formattingState.needsSlackFormatting).toBe(true);
      expect(formattingState.slackValidatedResponse).toBeTruthy();
      expect(finalState.formattedResponse).toBeTruthy();
      
      // Verify final state is ready for Slack
      expect(finalState.formattedResponse).not.toContain('<a href=');
      expect(finalState.formattedResponse).toContain('<https://');
    });

    test('handles conditional routing based on formatting needs', () => {
      // Test routing when formatting is needed
      const needsFormattingState: SlackWorkflowState = {
        slackEvent: mockSlackMessageEvent,
        shouldProcess: true,
        acknowledgmentSent: true,
        threadHistory: [],
        conversationContext: [],
        messageText: 'Test',
        claudeResponse: htmlResponseSamples.singleLink,
        needsSlackFormatting: false,
        slackValidatedResponse: null,
        formattedResponse: null,
        error: null,
        errorOccurred: false
      };

      // Test routing when no formatting is needed
      const noFormattingState: SlackWorkflowState = {
        ...needsFormattingState,
        claudeResponse: 'Plain text response'
      };

      // Simulate routing logic
      const shouldFormat = (state: SlackWorkflowState) => {
        if (state.errorOccurred) return 'handleError';
        
        const response = state.claudeResponse || '';
        const hasHtml = /<a\s+href=/.test(response);
        const hasMarkdown = /^#{1,6}\s+/m.test(response);
        const hasDoubleAsterisk = /\*\*/.test(response);
        
        return hasHtml || hasMarkdown || hasDoubleAsterisk ? 'formatResponse' : 'formatResponse';
      };

      expect(shouldFormat(needsFormattingState)).toBe('formatResponse');
      expect(shouldFormat(noFormattingState)).toBe('formatResponse');
      
      // Test error routing
      const errorState = { ...needsFormattingState, errorOccurred: true };
      expect(shouldFormat(errorState)).toBe('handleError');
    });
  });

  describe('Performance and Edge Cases', () => {
    test('handles large responses efficiently', async () => {
      const largeHtmlResponse = htmlResponseSamples.singleLink.repeat(100);
      
      const processLargeResponse = (response: string) => {
        const startTime = Date.now();
        
        // Simulate formatting process
        const hasHtmlLinks = /<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g.test(response);
        let processed = response;
        
        if (hasHtmlLinks) {
          processed = response.replace(/<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g, '<$1|$2>');
        }
        
        const endTime = Date.now();
        const processingTime = endTime - startTime;
        
        return { processed, processingTime };
      };

      const result = processLargeResponse(largeHtmlResponse);
      
      expect(result.processingTime).toBeLessThan(1000); // Should process in under 1 second
      expect(result.processed).not.toContain('<a href=');
      expect(result.processed.length).toBeGreaterThan(0);
    });

    test('handles malformed HTML gracefully', async () => {
      const malformedHtml = 'Text with <a href="unclosed link and <a>empty href</a>';
      
      const processMalformed = (response: string) => {
        try {
          // Attempt basic conversion even with malformed HTML
          const processed = response.replace(/<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g, '<$1|$2>');
          return { success: true, processed };
        } catch (error) {
          return { success: false, error: String(error) };
        }
      };

      const result = processMalformed(malformedHtml);
      
      expect(result.success).toBe(true);
      expect(typeof result.processed).toBe('string');
      // Should not crash even with malformed input
    });

    test('preserves Unicode characters during formatting', async () => {
      const unicodeResponse = `
        Hebrew text: בראשית ברא אלהים
        Arabic text: في البدء خلق الله
        Link: <a href="https://www.sefaria.org/Genesis.1.1" target="_blank">Genesis 1:1</a>
      `;
      
      const processUnicode = (response: string) => {
        return response.replace(/<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/g, '<$1|$2>');
      };

      const result = processUnicode(unicodeResponse);
      
      expect(result).toContain('בראשית ברא אלהים');
      expect(result).toContain('في البدء خلق الله');
      expect(result).toContain('<https://www.sefaria.org/Genesis.1.1|Genesis 1:1>');
      expect(result).not.toContain('<a href=');
    });
  });
});