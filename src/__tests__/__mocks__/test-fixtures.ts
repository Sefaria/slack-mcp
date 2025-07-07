// Test fixtures and sample data for testing
import { SlackMessageEvent, SlackMessage } from '../../types';

export const mockSlackMessageEvent: SlackMessageEvent = {
  type: 'message',
  user: 'U12345USER',
  text: '<@U12345BOT> What is the meaning of Genesis 1:1?',
  ts: '1234567890.123456',
  channel: 'C12345CHANNEL',
  event_ts: '1234567890.123456'
};

export const mockThreadMessage: SlackMessage = {
  user: 'U12345USER',
  text: 'Follow up question about the verse',
  ts: '1234567890.123457',
  thread_ts: '1234567890.123456'
};

// Sample HTML responses that need Slack formatting
export const htmlResponseSamples = {
  singleLink: `The <a href="https://www.sefaria.org/Midrash_Tanchuma%2C_Bereshit.4.1" target="_blank">Midrash Tanchuma on Bereshit 4:1</a> explains this concept.`,
  
  multipleLinks: `See <a href="https://www.sefaria.org/Genesis.3.4" target="_blank">Genesis 3:4</a> and <a href="https://www.sefaria.org/Rabbeinu_Bahya%2C_Devarim.6.9.2" target="_blank">Rabbeinu Bahya on Deuteronomy 6:9</a> for more details.`,
  
  withMarkdownHeaders: `## Main Topic\nThe <a href="https://www.sefaria.org/Song_of_Songs.2.15" target="_blank">Song of Songs 2:15</a> discusses:\n### Subsection\nDetailed analysis follows.`,
  
  withDoubleAsterisks: `This is **very important** text with <a href="https://www.sefaria.org/Genesis.1.1" target="_blank">Genesis 1:1</a> reference.`
};

// Expected Slack-formatted outputs
export const expectedSlackFormatted = {
  singleLink: `The <https://www.sefaria.org/Midrash_Tanchuma,_Bereshit.4.1|Midrash Tanchuma on Bereshit 4:1> explains this concept.`,
  
  multipleLinks: `See <https://www.sefaria.org/Genesis.3.4|Genesis 3:4> and <https://www.sefaria.org/Rabbeinu_Bahya,_Devarim.6.9.2|Rabbeinu Bahya on Deuteronomy 6:9> for more details.`,
  
  withMarkdownHeaders: `*Main Topic*\nThe <https://www.sefaria.org/Song_of_Songs.2.15|Song of Songs 2:15> discusses:\n*Subsection*\nDetailed analysis follows.`,
  
  withDoubleAsterisks: `This is *very important* text with <https://www.sefaria.org/Genesis.1.1|Genesis 1:1> reference.`
};

// Complex Sefaria URL test cases
export const sefariaUrlTestCases = [
  {
    name: 'URL encoded commas',
    input: 'https://www.sefaria.org/Midrash_Tanchuma%2C_Bereshit.4.1',
    expected: 'https://www.sefaria.org/Midrash_Tanchuma,_Bereshit.4.1'
  },
  {
    name: 'Spaces in book names',
    input: 'https://www.sefaria.org/Song of Songs.2.15',
    expected: 'https://www.sefaria.org/Song_of_Songs.2.15'
  },
  {
    name: 'Verse colons to periods',
    input: 'https://www.sefaria.org/Genesis 3:4',
    expected: 'https://www.sefaria.org/Genesis_3.4'
  },
  {
    name: 'Commentary with spaces and commas',
    input: 'https://www.sefaria.org/Rabbeinu_Bahya%2C_Devarim.6.9.2',
    expected: 'https://www.sefaria.org/Rabbeinu_Bahya,_Devarim.6.9.2'
  }
];

// Emoji selection test cases
export const emojiTestCases = [
  {
    text: 'שבת שלום',
    expectedFallback: 'scroll'
  },
  {
    text: 'What is the meaning of life?',
    expectedFallback: 'thinking_face'
  },
  {
    text: 'Please help me understand this passage',
    expectedFallback: 'thinking_face'
  }
];

// Coverage warning test cases
export const coverageTestCases = [
  {
    input: 'This topic has limited coverage in our sources.',
    shouldHaveWarning: true
  },
  {
    input: 'There are few sources available for this question.',
    shouldHaveWarning: true
  },
  {
    input: 'This is well documented in Jewish texts.',
    shouldHaveWarning: false
  }
];