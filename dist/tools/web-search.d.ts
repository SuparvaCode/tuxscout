import { type ProxyInput } from '../utils/http.js';
export type SearchTimeRange = 'day' | 'week' | 'month' | 'year' | 'any';
export type SearchType = 'general' | 'pdf' | 'imdb' | 'academic' | 'code' | 'docs' | 'books';
export type SearchVertical = SearchType;
export interface WebSource {
    title: string;
    url: string;
    description: string;
    engine?: string;
    isPdf?: boolean;
    fileType?: string;
    year?: number;
    rating?: number;
    extra?: Record<string, unknown>;
}
export interface SearchAttempt {
    engine: string;
    ok: boolean;
    status: number;
    ms: number;
    count: number;
    reason?: string;
    detail?: string;
}
export interface WebSearchOptions {
    query?: string;
    queries?: string[];
    n?: number;
    engine?: string;
    noCache?: boolean;
    timeoutMs?: number;
    /** Optional HTTP/HTTPS/SOCKS5 proxy URL, host:port, or rotation list */
    proxy?: ProxyInput;
    /** Search vertical preset ('general' | 'pdf' | 'imdb' | 'academic' | 'code' | 'docs' | 'books') */
    searchType?: SearchType;
    /** Restrict search to specific domain(s) (e.g. "imdb.com" or ["arxiv.org", "kernel.org"]) */
    site?: string | string[];
    /** Exclude specific domain(s) (e.g. "pinterest.com") */
    excludeSite?: string | string[];
    /** Filter by file type / extension (e.g. "pdf", "doc", "csv") */
    filetype?: string;
    /** Shorthand to search for PDF documents across web + academic PDF repositories */
    pdfOnly?: boolean;
    /** Require term in page title (intitle:) */
    intitle?: string;
    /** Require term in page URL (inurl:) */
    inurl?: string;
    /** Require exact phrase match */
    exactPhrase?: string;
    /** Terms to exclude from results */
    excludeTerms?: string | string[];
    /** Recency filter ('day' | 'week' | 'month' | 'year' | 'any') */
    timeRange?: SearchTimeRange;
    /** Region/locale hint (e.g. 'us-en', 'uk-en', 'in-en') */
    region?: string;
}
export interface WebSearchResult {
    internet_data: string;
    sources: WebSource[];
    engine: string | null;
    engines: string[];
    no_results: boolean;
    attempts: SearchAttempt[];
    cached: boolean;
    ms: number;
    intent?: Intent;
    queries_executed?: string[];
    search_type?: SearchType;
    searchType?: SearchType;
}
export type Intent = 'news' | 'evergreen' | 'navigational';
export declare function stripSearchOperators(query: string): string;
export declare function isPdfUrl(u: string): boolean;
export declare function detectFileType(u: string): string | undefined;
export declare function buildAdvancedQuery(baseQuery: string, options?: WebSearchOptions): string;
export declare function queryTerms(query: string): string[];
export declare function subjectTerms(query: string): string[];
export declare function classifyIntent(query: string): Intent;
export declare function looksLikeLandingPage(url: string): boolean;
export declare function relevance(source: WebSource, terms: string[]): number;
export declare function isWorthKeeping(source: WebSource, terms: string[], intent: Intent, subject: string[]): boolean;
export declare function engineRelevanceVerdict(sources: WebSource[], query: string): {
    total: number;
    strong: number;
    ratio: number;
};
export declare function rankSources(sources: WebSource[], terms: string[], preferPdf?: boolean): WebSource[];
export declare function mergeQueries(results: WebSource[][], n: number): WebSource[];
export declare function webSearch(options: WebSearchOptions): Promise<WebSearchResult>;
/**
 * Dedicated IMDb search helper (movies, TV series, actors, directors).
 */
export declare function searchImdb(query: string, nOrOptions?: number | Omit<WebSearchOptions, 'query' | 'searchType'>, proxy?: ProxyInput): Promise<WebSearchResult>;
/**
 * Dedicated PDF search helper across web search engines + ArXiv + OpenAlex.
 */
export declare function searchPdf(query: string, nOrOptions?: number | Omit<WebSearchOptions, 'query' | 'searchType' | 'pdfOnly'>, proxy?: ProxyInput): Promise<WebSearchResult>;
//# sourceMappingURL=web-search.d.ts.map