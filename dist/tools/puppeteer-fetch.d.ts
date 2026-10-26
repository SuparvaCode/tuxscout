import { type ProxyInput } from '../utils/http.js';
import { type PageMetadata } from '../utils/html.js';
export interface PuppeteerFetchOptions {
    url: string;
    waitUntil?: 'domcontentloaded' | 'networkidle2' | 'networkidle0' | 'load';
    timeoutMs?: number;
    waitForSelector?: string;
    waitAfterLoadMs?: number;
    scrollToBottom?: boolean;
    blockResources?: boolean;
    blockStylesheets?: boolean;
    includeLinks?: boolean;
    includeImages?: boolean;
    maxChars?: number;
    onlyMainContent?: boolean;
    evaluateScript?: string;
    screenshotPath?: string;
    fullPageScreenshot?: boolean;
    userAgent?: string;
    extraHeaders?: Record<string, string>;
    cookies?: Array<{
        name: string;
        value: string;
        domain?: string;
        path?: string;
    }>;
    closeBrowserAfter?: boolean;
    /** Optional HTTP/HTTPS/SOCKS5 proxy URL or proxy list for rotation */
    proxy?: ProxyInput;
}
export interface PuppeteerFetchResult {
    url: string;
    finalUrl: string;
    status: number;
    title: string;
    metadata: PageMetadata;
    markdown: string;
    textContent: string;
    html?: string;
    evaluatedResult?: unknown;
    screenshotPath?: string;
    links: Array<{
        text: string;
        url: string;
    }>;
    images: Array<{
        alt: string;
        url: string;
    }>;
    blockedRequestsCount: number;
    allowedRequestsCount: number;
    ms: number;
    browserExecutable: string;
}
export declare function findBrowserExecutable(): string;
export declare function closePuppeteerPool(): Promise<void>;
export declare function fetchWithPuppeteer(options: PuppeteerFetchOptions): Promise<PuppeteerFetchResult>;
//# sourceMappingURL=puppeteer-fetch.d.ts.map