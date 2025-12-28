import { SefariaAgentClient } from './sefaria-agent-client';

export type AgentToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  is_error?: boolean;
};

export class SefariaAgentTools {
  private client: SefariaAgentClient;

  constructor(client?: SefariaAgentClient) {
    this.client = client || new SefariaAgentClient();
  }

  async execute(toolName: string, input: any): Promise<AgentToolResult> {
    try {
      switch (toolName) {
        case 'get_text':
          return this.wrap(await this.client.getText(input.reference, input.version_language));
        case 'text_search':
          return this.wrap(await this.client.textSearch(input.query, input.filters, input.size ?? 10));
        case 'get_current_calendar':
          return this.wrap(await this.client.getCurrentCalendar());
        case 'english_semantic_search':
          return this.wrap(await this.client.englishSemanticSearch(input.query, input.filters));
        case 'get_links_between_texts':
          return this.wrap(await this.client.getLinksBetweenTexts(input.reference, input.with_text ?? '0'));
        case 'search_in_book':
          return this.wrap(await this.client.searchInBook(input.query, input.book_name, input.size ?? 10));
        case 'search_in_dictionaries':
          return this.wrap(await this.client.searchInDictionaries(input.query));
        case 'get_english_translations':
          return this.wrap(await this.client.getEnglishTranslations(input.reference));
        case 'get_topic_details':
          return this.wrap(await this.client.getTopicDetails(input.topic_slug, !!input.with_links, !!input.with_refs));
        case 'clarify_name_argument':
          return this.wrap(await this.client.clarifyNameArgument(input.name, input.limit, input.type_filter));
        case 'clarify_search_path_filter':
          return this.wrap({ filter_path: await this.client.clarifySearchPathFilter(input.book_name) });
        case 'get_text_or_category_shape':
          return this.wrap(await this.client.getTextOrCategoryShape(input.name));
        case 'get_text_catalogue_info':
          return this.wrap(await this.client.getTextCatalogueInfo(input.title));
        case 'get_available_manuscripts':
          return this.wrap(await this.client.getAvailableManuscripts(input.reference));
        case 'get_manuscript_image':
          return this.wrap(await this.client.getManuscriptImage(input.image_url, input.manuscript_title));
        default:
          return this.wrapError(`Unknown tool: ${toolName}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.wrapError(message);
    }
  }

  private wrap(payload: unknown): AgentToolResult {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    return { content: [{ type: 'text', text }] };
  }

  private wrapError(message: string): AgentToolResult {
    return {
      is_error: true,
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }]
    };
  }
}

