export interface WebSource {
    title: string;
    url: string;
    description: string;
    engine?: string;
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
}
export type Intent = 'news' | 'evergreen' | 'navigational';
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
export declare function rankSources(sources: WebSource[], terms: string[]): WebSource[];
export declare function mergeQueries(results: WebSource[][], n: number): WebSource[];
export declare function webSearch(options: WebSearchOptions): Promise<WebSearchResult>;
//# sourceMappingURL=web-search.d.ts.map