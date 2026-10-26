export type ApiAnythingProvider = 'twitter' | 'instagram' | 'reddit' | 'github' | 'tiktok' | 'hackernews' | 'youtube' | 'stackoverflow' | 'arxiv' | 'wikipedia' | 'npm' | 'pypi' | 'webpage';
export interface ApiAnythingOptions {
    /** URL or prefixed target (e.g. "https://x.com/...", "ig:nasa", "npm:tuxscout", "arxiv:2401.00001", "so:node fetch timeout") */
    target: string;
    /** Max items/comments/chars depending on provider */
    limit?: number;
    /** Max markdown characters for generic webpage extraction (default 6000) */
    maxChars?: number;
    /** Bypass cache */
    noCache?: boolean;
}
export interface ApiAnythingResult {
    ok: boolean;
    provider: ApiAnythingProvider;
    target: string;
    structured: unknown;
    markdown: string;
    cached: boolean;
    ms: number;
    error?: string;
}
export declare function fetchStackOverflow(target: string, limit?: number): Promise<any>;
export declare function fetchArxiv(target: string, limit?: number): Promise<{
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
export declare function fetchWikipediaSummary(target: string): Promise<{
    title: any;
    description: any;
    extract: any;
    url: any;
    thumbnailUrl: any;
    coordinates: any;
    lastModified: any;
}>;
export declare function fetchNpmPackage(target: string): Promise<{
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
export declare function fetchPypiPackage(target: string): Promise<{
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
export declare function extractStructuredWebpage(url: string, maxChars?: number): Promise<{
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
export declare function detectApiProvider(target: string): ApiAnythingProvider;
export declare function apiAnything(options: ApiAnythingOptions): Promise<ApiAnythingResult>;
//# sourceMappingURL=api-anything.d.ts.map