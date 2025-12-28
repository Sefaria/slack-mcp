// Internal (in-process) reimplementation of the Sefaria MCP tools from `sefaria_mcp/logic.py`.
// Kept standalone so only the Agent-API bot uses it; other bots can continue using remote MCP.

declare const fetch: any;

const DEFAULT_SEFARIA_BASE_URL = process.env.SEFARIA_API_BASE_URL || 'https://www.sefaria.org';

const VIRTUAL_HAVRUTA_HTTP_SERVICE_HOST = process.env.VIRTUAL_HAVRUTA_HTTP_SERVICE_HOST;
const VIRTUAL_HAVRUTA_HTTP_SERVICE_PORT = process.env.VIRTUAL_HAVRUTA_HTTP_SERVICE_PORT;

const DEFAULT_SEFARIA_AI_BASE_URL =
  VIRTUAL_HAVRUTA_HTTP_SERVICE_HOST && VIRTUAL_HAVRUTA_HTTP_SERVICE_PORT
    ? `http://${VIRTUAL_HAVRUTA_HTTP_SERVICE_HOST}:${VIRTUAL_HAVRUTA_HTTP_SERVICE_PORT}`
    : process.env.SEFARIA_AI_BASE_URL || 'https://ai.sefaria.org';

const LEXICON_MAP: Record<string, string> = {
  'Reference/Dictionary/Jastrow': 'Jastrow Dictionary',
  'Reference/Dictionary/Klein Dictionary': 'Klein Dictionary',
  'Reference/Dictionary/BDB': 'BDB Dictionary',
  'Reference/Dictionary/BDB Aramaic': 'BDB Aramaic Dictionary',
  'Reference/Encyclopedic Works/Kovetz Yesodot VaChakirot': 'Kovetz Yesodot VaChakirot'
};

const LEXICON_SEARCH_FILTERS = Object.keys(LEXICON_MAP);

export class SefariaAgentClient {
  private baseUrl: string;
  private aiBaseUrl: string;

  constructor(options?: { baseUrl?: string; aiBaseUrl?: string }) {
    this.baseUrl = options?.baseUrl || DEFAULT_SEFARIA_BASE_URL;
    this.aiBaseUrl = options?.aiBaseUrl || DEFAULT_SEFARIA_AI_BASE_URL;
  }

  async getText(reference: string, versionLanguage?: 'source' | 'english' | 'both'): Promise<any> {
    const encodedRef = encodeURIComponent(reference);
    const params: Record<string, string> = {};

    if (versionLanguage === 'source') params.version = 'source';
    if (versionLanguage === 'english') params.version = 'english';
    if (versionLanguage === 'both') params.version = 'english|source';

    const data = await this.getJson(`api/v3/texts/${encodedRef}`, params);
    return optimizeTextResponse(data);
  }

  async textSearch(query: string, filters?: string[] | null, size: number = 10): Promise<any[]> {
    const data = await this.search(query, filters || undefined, size);
    const results = formatSearchResults(data, filters || undefined);
    if (results.length > 0) return results;

    if (filters && filters.length > 0) {
      const fallbackData = await this.search(query, undefined, size);
      return formatSearchResults(fallbackData, undefined, filters);
    }

    return [];
  }

  async getCurrentCalendar(): Promise<any> {
    const calendarData = await this.getJson('api/calendars');
    return {
      ...calendarData,
      'Gregorian Date': new Date().toISOString()
    };
  }

  async englishSemanticSearch(query: string, filters?: Record<string, unknown>): Promise<any> {
    const payload: any = { query };
    if (filters) payload.filters = filters;

    const bearer = process.env.SEFARIA_AI_TOKEN;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;

    const url = `${this.aiBaseUrl.replace(/\/$/, '')}/api/knn-search`;
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!response.ok) {
      throw new Error(`Sefaria AI API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  async getLinksBetweenTexts(reference: string, withText: string = '0'): Promise<any> {
    const encodedRef = encodeURIComponent(reference);
    const data = await this.getJson(`api/links/${encodedRef}`, { with_text: withText });
    return optimizeLinksResponse(data);
  }

  async searchInBook(query: string, bookName: string, size: number = 10): Promise<any> {
    const filterPath = await this.clarifySearchPathFilter(bookName);
    if (!filterPath) {
      return { error: `Could not find valid filter path for book '${bookName}'` };
    }
    return this.textSearch(query, [filterPath], size);
  }

  async searchInDictionaries(query: string): Promise<any> {
    const response = await this.search(query, LEXICON_SEARCH_FILTERS, 8);
    const hits = response?.hits?.hits || [];
    return hits.map((hit: any) => ({
      ref: hit?._source?.ref,
      headword: hit?._source?.titleVariants?.[0],
      lexicon_name: LEXICON_MAP[hit?._source?.path] || hit?._source?.path,
      text: hit?._source?.exact
    }));
  }

  async getEnglishTranslations(reference: string): Promise<any> {
    const encodedRef = encodeURIComponent(reference);
    const data = await this.getJson(`api/v3/texts/${encodedRef}`, { version: 'english|all' });
    const englishTranslations =
      data?.versions?.map((version: any) => ({
        versionTitle: version?.versionTitle || '',
        text: version?.text || ''
      })) || [];

    return { reference, englishTranslations };
  }

  async getTopicDetails(topicSlug: string, withLinks: boolean = false, withRefs: boolean = false): Promise<any> {
    const encodedSlug = encodeURIComponent(topicSlug);
    const params: Record<string, string> = {};
    if (withLinks) params.with_links = '1';
    if (withRefs) params.with_refs = '1';
    const data = await this.getJson(`api/v2/topics/${encodedSlug}`, params);
    return optimizeTopicsResponse(data);
  }

  async clarifyNameArgument(name: string, limit?: number | null, typeFilter?: string | null): Promise<any> {
    const encodedName = encodeURIComponent(name);
    const params: Record<string, string> = {};
    if (limit !== undefined && limit !== null) params.limit = String(limit);
    if (typeFilter) params.type = typeFilter;
    return this.getJson(`api/name/${encodedName}`, params);
  }

  async clarifySearchPathFilter(bookName: string): Promise<string | null> {
    const encodedName = encodeURIComponent(bookName);
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/search-path-filter/${encodedName}`;
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      return null;
    }
    const text = await response.text();
    return text.trim() || null;
  }

  async getTextOrCategoryShape(name: string): Promise<any> {
    const encodedName = encodeURIComponent(name);
    return this.getJson(`api/shape/${encodedName}`);
  }

  async getTextCatalogueInfo(title: string): Promise<any> {
    const encodedTitle = encodeURIComponent(title);
    const data = await this.getJson(`api/v2/raw/index/${encodedTitle}`);
    return optimizeIndexResponse(data);
  }

  async getAvailableManuscripts(reference: string): Promise<any> {
    const encodedRef = encodeURIComponent(reference);
    return this.getJson(`api/manuscripts/${encodedRef}`);
  }

  async getManuscriptImage(imageUrl: string, manuscriptTitle?: string | null): Promise<any> {
    const response = await fetch(imageUrl, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Error downloading manuscript image: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers?.get?.('content-type') || 'image/jpeg';
    const buf = Buffer.from(await response.arrayBuffer());
    const base64 = buf.toString('base64');

    const filename = imageUrl.split('/').pop() || 'manuscript.jpg';
    const title = manuscriptTitle || `Manuscript: ${filename}`;

    return {
      success: true,
      image_data: base64,
      mime_type: contentType,
      size: buf.byteLength,
      original_size: buf.byteLength,
      was_resized: false,
      filename,
      title,
      source_url: imageUrl
    };
  }

  private async search(query: string, filters?: string[], size: number = 8): Promise<any> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/search-wrapper/es8`;
    const filterList = filters || [];
    const filterFields = new Array(filterList.length).fill(null);

    const payload = {
      aggs: [],
      field: 'naive_lemmatizer',
      filter_fields: filterFields,
      filters: filterList,
      query,
      size,
      slop: 10,
      sort_fields: ['pagesheetrank'],
      sort_method: 'score',
      sort_reverse: false,
      sort_score_missing: 0.04,
      source_proj: true,
      type: 'text'
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(`Sefaria search API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  private async getJson(endpoint: string, params?: Record<string, string>): Promise<any> {
    const normalizedBase = this.baseUrl.replace(/\/$/, '');
    const url = new URL(`${normalizedBase}/${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
      });
    }
    const response = await fetch(url.toString(), { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Sefaria API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }
}

function optimizeTextResponse(data: any): any {
  if (typeof data !== 'object' || data === null) return data;
  const essentialFields = new Set([
    'ref',
    'versions',
    'available_versions',
    'requestedRef',
    'spanningRefs',
    'textType',
    'sectionRef',
    'he',
    'text',
    'primary_title'
  ]);

  const optimized: any = {};
  for (const key of Object.keys(data)) {
    if (essentialFields.has(key)) optimized[key] = data[key];
  }

  if (Array.isArray(optimized.versions)) {
    optimized.versions = optimized.versions.map((version: any) => ({
      text: version?.text ?? '',
      versionTitle: version?.versionTitle ?? '',
      languageFamilyName: version?.languageFamilyName ?? '',
      versionSource: version?.versionSource ?? ''
    }));
  }

  if (Array.isArray(optimized.available_versions)) {
    optimized.available_versions = optimized.available_versions.map((version: any) => ({
      versionTitle: version?.versionTitle ?? '',
      languageFamilyName: version?.languageFamilyName ?? ''
    }));
  }

  return optimized;
}

function optimizeLinksResponse(data: any): any {
  if (!Array.isArray(data)) return data;
  return data.map(link => {
    const optimized: any = {
      ref: link?.ref || '',
      sourceRef: link?.sourceRef || '',
      anchorText: link?.anchorText || '',
      type: link?.type || '',
      category: link?.category || ''
    };
    if (typeof link?.text === 'string') {
      optimized.text = link.text.length < 500 ? link.text : `${link.text.slice(0, 500)}...`;
    }
    return optimized;
  });
}

function optimizeTopicsResponse(data: any): any {
  if (typeof data !== 'object' || data === null) return data;
  const essentialFields = new Set([
    'slug',
    'titles',
    'description',
    'categoryDescription',
    'numSources',
    'primaryTitle',
    'image',
    'good_to_promote'
  ]);

  const optimized: any = {};
  for (const key of Object.keys(data)) {
    if (essentialFields.has(key)) optimized[key] = data[key];
  }

  if (Array.isArray(data.links)) {
    optimized.links = data.links.slice(0, 10);
  }

  if (Array.isArray(data.refs)) {
    optimized.refs = data.refs.slice(0, 10);
    optimized.refs_note = `Showing first 10 of ${data.refs.length} total refs`;
  }

  return optimized;
}

function optimizeIndexResponse(data: any): any {
  if (typeof data !== 'object' || data === null) return data;
  const essentialFields = new Set([
    'title',
    'heTitle',
    'titleVariants',
    'schema',
    'categories',
    'sectionNames',
    'addressTypes',
    'length',
    'lengths',
    'textDepth',
    'primaryTitle',
    'compDate',
    'era',
    'authors'
  ]);

  const optimized: any = {};
  for (const key of Object.keys(data)) {
    if (essentialFields.has(key)) optimized[key] = data[key];
  }

  return optimized;
}

function formatSearchResults(data: any, filterUsed?: string[] | null, originalFilters?: string[] | null): any[] {
  const hits = data?.hits?.hits;
  if (!Array.isArray(hits)) return [];

  const results: any[] = [];
  for (const hit of hits) {
    const source = hit?._source || {};
    const filteredResult: any = {
      ref: source.ref || '',
      categories: source.categories || []
    };

    if (originalFilters && (!filterUsed || filterUsed.length === 0)) {
      filteredResult.original_filter = originalFilters;
      filteredResult.filter_correction = 'Removed filters due to no results';
    }

    let textSnippet = '';
    if (hit.highlight) {
      for (const highlights of Object.values(hit.highlight)) {
        if (Array.isArray(highlights) && highlights.length > 0) {
          textSnippet = highlights.join(' [...] ');
          break;
        }
      }
    }

    if (!textSnippet) {
      for (const fieldName of ['naive_lemmatizer', 'exact']) {
        const content = source[fieldName];
        if (typeof content === 'string' && content.length > 0) {
          textSnippet = content.slice(0, 300) + (content.length > 300 ? '...' : '');
          break;
        }
      }
    }

    filteredResult.text_snippet = textSnippet;
    results.push(filteredResult);
  }

  return results;
}
