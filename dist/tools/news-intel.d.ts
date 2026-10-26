export type NewsCategory = 'top' | 'world' | 'tech' | 'ai' | 'security' | 'science' | 'business' | 'crypto' | 'linux' | 'opensource' | 'hn';
export type NewsTimeframe = '1h' | '24h' | '7d' | '30d' | 'any';
export type NewsRecency = NewsTimeframe;
export interface NewsItem {
    title: string;
    url: string;
    source: string;
    publishedAt: string;
    summary?: string;
    points?: number;
    commentsCount?: number;
    discussionUrl?: string;
    author?: string;
}
export interface NewsIntelOptions {
    /** Custom search topic or HackerNews item ID */
    query?: string;
    /** Predefined category ('top' | 'world' | 'tech' | 'ai' | 'security' | 'science' | 'business' | 'crypto' | 'linux' | 'opensource' | 'hn') */
    category?: NewsCategory;
    /** Timeframe filter for search ('1h' | '24h' | '7d' | '30d' | 'any', default '24h') */
    when?: NewsTimeframe;
    /** Max headlines to return (default 15) */
    limit?: number;
    /** Specific Hacker News story ID to inspect with comments */
    hnItemId?: string | number;
    /** Bypass cache */
    noCache?: boolean;
}
export interface NewsIntelResult {
    ok: boolean;
    category: NewsCategory;
    query?: string;
    when: NewsTimeframe;
    total: number;
    items: NewsItem[];
    hnDiscussion?: {
        id: number;
        title: string;
        url?: string;
        points: number;
        author: string;
        createdAt: string;
        text?: string;
        comments: Array<{
            id: number;
            author: string;
            createdAt: string;
            text: string;
            repliesCount: number;
        }>;
    };
    markdown: string;
    cached: boolean;
    ms: number;
}
export declare function fetchGoogleNewsSearch(query: string, when?: NewsTimeframe, limit?: number): Promise<NewsItem[]>;
export declare function fetchHackerNews(query?: string, limit?: number): Promise<NewsItem[]>;
export declare function fetchHackerNewsItem(itemId: string | number, maxComments?: number): Promise<{
    id: number;
    title: string;
    url: any;
    points: number;
    author: string;
    createdAt: string;
    text: string | undefined;
    comments: {
        id: number;
        author: string;
        createdAt: string;
        text: string;
        repliesCount: any;
    }[];
}>;
export declare function newsIntel(options?: NewsIntelOptions): Promise<NewsIntelResult>;
//# sourceMappingURL=news-intel.d.ts.map