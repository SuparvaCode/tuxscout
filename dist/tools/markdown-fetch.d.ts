import { type ProxyInput } from '../utils/http.js';
import { type PageMetadata } from '../utils/html.js';
export interface MarkdownFetchOptions {
    url: string;
    timeoutMs?: number;
    maxChars?: number;
    includeLinks?: boolean;
    includeImages?: boolean;
    onlyMainContent?: boolean;
    autoPuppeteer?: boolean;
    forcePuppeteer?: boolean;
    noCache?: boolean;
    headers?: Record<string, string>;
    /** Optional HTTP/HTTPS/SOCKS5 proxy URL or proxy list for rotation */
    proxy?: ProxyInput;
}
export interface MarkdownFetchResult {
    url: string;
    finalUrl: string;
    domain: string;
    status: number;
    ok: boolean;
    method: 'http' | 'puppeteer' | 'api';
    escalatedReason?: string;
    title: string;
    metadata: PageMetadata;
    markdown: string;
    textContent: string;
    wordCount: number;
    charCount: number;
    links: Array<{
        text: string;
        url: string;
    }>;
    images: Array<{
        alt: string;
        url: string;
    }>;
    needsJs: boolean;
    cached: boolean;
    ms: number;
    error?: string;
}
export declare function fetchMarkdown(options: MarkdownFetchOptions): Promise<MarkdownFetchResult>;
export declare function fetchMarkdownBatch(urls: string[], options?: Omit<MarkdownFetchOptions, 'url'> & {
    concurrency?: number;
}): Promise<MarkdownFetchResult[]>;
//# sourceMappingURL=markdown-fetch.d.ts.map