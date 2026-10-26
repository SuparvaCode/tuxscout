import { type ProxyInput } from '../utils/http.js';
export type SmartExtractProvider = 'twitter' | 'instagram' | 'reddit' | 'github' | 'tiktok' | 'hackernews' | 'youtube' | 'stackoverflow' | 'arxiv' | 'wikipedia' | 'imdb' | 'pdf' | 'npm' | 'pypi' | 'webpage';
export type ExtractProvider = SmartExtractProvider;
export interface SmartExtractOptions {
    /** URL or prefixed target (e.g. "https://x.com/...", "imdb:Inception", "pdf:https://...", "ig:nasa", "npm:tuxscout", "arxiv:2401.00001", "so:node fetch timeout") */
    target: string;
    /** Optional explicit provider override */
    provider?: SmartExtractProvider;
    /** Max items/comments/chars depending on provider */
    limit?: number;
    /** Max markdown characters for generic webpage or PDF extraction (default 6000) */
    maxChars?: number;
    /** Bypass cache */
    noCache?: boolean;
    /** Optional HTTP/HTTPS/SOCKS5 proxy URL, host:port, or rotation list */
    proxy?: ProxyInput;
}
export interface SmartExtractResult {
    ok: boolean;
    provider: SmartExtractProvider;
    target: string;
    structured: unknown;
    markdown: string;
    cached: boolean;
    ms: number;
    error?: string;
}
export declare function fetchStackOverflow(target: string, limit?: number, proxy?: ProxyInput): Promise<any>;
export declare function fetchArxiv(target: string, limit?: number, proxy?: ProxyInput): Promise<{
    arxivId: string;
    title: string;
    authors: string[];
    publishedAt: string;
    updatedAt: string;
    categories: string[];
    absUrl: string;
    pdfUrl: string;
    abstract: string;
}[]>;
export declare function fetchWikipediaSummary(target: string, proxy?: ProxyInput): Promise<{
    title: any;
    description: any;
    extract: any;
    url: any;
    thumbnailUrl: any;
    coordinates: any;
    lastModified: any;
}>;
export declare function fetchNpmPackage(target: string, proxy?: ProxyInput): Promise<{
    name: any;
    version: any;
    description: any;
    license: any;
    homepage: any;
    repository: any;
    weeklyDownloads: any;
    dependencies: string[];
    peerDependencies: string[];
    bin: string[];
    keywords: any;
    npmUrl: string;
}>;
export declare function fetchPypiPackage(target: string, proxy?: ProxyInput): Promise<{
    name: any;
    version: any;
    summary: any;
    license: any;
    requiresPython: any;
    author: any;
    homepage: any;
    projectUrls: any;
    dependencies: any;
    pypiUrl: any;
}>;
export interface ImdbTitleDetails {
    imdbId: string;
    url: string;
    title: string;
    originalTitle?: string;
    type?: string;
    year?: number | string;
    releaseDate?: string;
    contentRating?: string;
    duration?: string;
    rating?: number;
    ratingCount?: number;
    genres?: string[];
    plot?: string;
    directors?: string[];
    creators?: string[];
    cast?: string[];
    keywords?: string[];
    posterUrl?: string;
    trailerUrl?: string;
}
export interface ImdbSearchResultItem {
    imdbId: string;
    title: string;
    type: string;
    year?: number | string;
    stars?: string;
    rank?: number;
    posterUrl?: string;
    url: string;
}
export interface ImdbExtractPayload {
    query: string;
    featured: ImdbTitleDetails | null;
    results: ImdbSearchResultItem[];
}
export declare function fetchImdb(target: string, limit?: number, proxy?: ProxyInput): Promise<ImdbExtractPayload>;
export declare function parsePdfBuffer(buffer: Buffer, maxChars?: number): {
    version: string;
    pageCount: number;
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    text: string;
};
export declare function fetchPdfDocument(target: string, maxChars?: number, limit?: number, proxy?: ProxyInput): Promise<{
    mode: "search";
    query: string;
    count: number;
    engines: string[];
    sources: import("./web-search.js").WebSource[];
    url?: undefined;
    status?: undefined;
    contentType?: undefined;
    byteLength?: undefined;
    pdfVersion?: undefined;
    pageCount?: undefined;
    title?: undefined;
    author?: undefined;
    subject?: undefined;
    creator?: undefined;
    text?: undefined;
} | {
    mode: "document";
    url: string;
    status: number;
    contentType: string;
    byteLength: number;
    pdfVersion: string;
    pageCount: number;
    title: string;
    author: string | undefined;
    subject: string | undefined;
    creator: string | undefined;
    text: string;
    query?: undefined;
    count?: undefined;
    engines?: undefined;
    sources?: undefined;
}>;
export declare function extractStructuredWebpage(url: string, maxChars?: number, proxy?: ProxyInput): Promise<{
    url: string;
    status: number;
    metadata: import("../utils/html.js").PageMetadata;
    jsonLd: unknown[];
    hasNextData: boolean;
    nextDataSample: unknown;
    feeds: {
        title: string;
        type: string;
        url: string;
    }[];
    tablesCount: number;
    tables: Record<string, string>[][];
    linksCount: number;
    topLinks: {
        text: string;
        url: string;
    }[];
    markdown: string;
}>;
export declare function detectExtractProvider(target: string): SmartExtractProvider;
export declare function smartExtract(options: SmartExtractOptions): Promise<SmartExtractResult>;
//# sourceMappingURL=smart-extract.d.ts.map