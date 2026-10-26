import { type ProxyInput } from '../utils/http.js';
import type { SearchAttempt } from './web-search.js';
export interface ImageItem {
    title: string;
    imageUrl: string;
    thumbUrl: string;
    sourceUrl: string;
    sourceSite: string;
    width: number;
    height: number;
    size: string;
    type: string;
    engine: string;
    license?: string;
}
export type SafeSearch = 'off' | 'moderate' | 'strict';
export interface ImageSearchOptions {
    query: string;
    n?: number;
    safe?: SafeSearch;
    engine?: string;
    /** Verify every returned imageUrl is live (HTTP 200 + valid image magic bytes). Default: true */
    verifyUrls?: boolean;
    noCache?: boolean;
    timeoutMs?: number;
    /** Optional HTTP/HTTPS/SOCKS5 proxy URL or proxy list for rotation */
    proxy?: ProxyInput;
}
export interface ImageSearchResult {
    total: number;
    showing: number;
    images: ImageItem[];
    engine: string | null;
    engines: string[];
    no_results: boolean;
    attempts: SearchAttempt[];
    cached: boolean;
    ms: number;
}
export interface DownloadedImage extends ImageItem {
    filePath: string;
    fileName: string;
    bytes: number;
    detectedType: string;
    usedThumbnailFallback: boolean;
}
export interface ImageDownloadOptions {
    query?: string;
    images?: Array<string | Partial<ImageItem> & {
        imageUrl: string;
    }>;
    outputDir: string;
    count?: number;
    safe?: SafeSearch;
    engine?: string;
    concurrency?: number;
    minBytes?: number;
    maxBytes?: number;
    timeoutPerImageMs?: number;
    allowThumbFallback?: boolean;
    saveManifest?: boolean;
    filenamePrefix?: string;
    /** Optional HTTP/HTTPS/SOCKS5 proxy URL or proxy list for rotation */
    proxy?: ProxyInput;
}
export interface ImageDownloadResult {
    outputDir: string;
    requested: number;
    downloadedCount: number;
    downloaded: DownloadedImage[];
    failedCount: number;
    failures: Array<{
        url: string;
        reason: string;
    }>;
    manifestPath?: string;
    ms: number;
}
export declare function imageSearch(options: ImageSearchOptions): Promise<ImageSearchResult>;
export declare function downloadImages(options: ImageDownloadOptions): Promise<ImageDownloadResult>;
//# sourceMappingURL=image-search.d.ts.map