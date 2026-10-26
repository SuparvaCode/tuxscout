export declare const DEFAULT_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
export declare const API_UA = "AgentToolsPack/1.0 (+https://southasia-one.kognare.com; Linux x86_64)";
export declare const BROWSER_HEADERS: Record<string, string>;
export declare class EngineError extends Error {
    reason: string;
    status: number;
    constructor(reason: string, status?: number, message?: string);
}
export declare const clean: (s: unknown) => string;
export declare const isHttpUrl: (u: string) => boolean;
export declare const num: (v: unknown) => number;
export declare function hostOf(u: string): string;
export type ProxyInput = string | string[] | null | undefined;
export interface ParsedProxy {
    raw: string;
    url: string;
    protocol: 'http:' | 'https:' | 'socks5:' | 'socks5h:' | 'socks4:' | 'socks:';
    host: string;
    port: number;
    username?: string;
    password?: string;
    /** Proxy server URL without credentials, suitable for Chromium --proxy-server */
    serverArg: string;
}
/**
 * Set or clear a process-wide default proxy (single URL, host:port, or rotation list).
 */
export declare function setGlobalProxy(proxy: ProxyInput): void;
export declare function getGlobalProxy(): ProxyInput;
/**
 * Normalize a single proxy string into a ParsedProxy object.
 * Supports:
 * - http://host:port, https://host:port, socks5://host:port
 * - http://user:pass@host:port, socks5://user:pass@host:port
 * - host:port (defaults to http://host:port)
 * - user:pass@host:port (defaults to http://user:pass@host:port)
 * - host:port:user:pass (common proxy provider shorthand -> http://user:pass@host:port)
 */
export declare function parseProxyString(rawInput: string): ParsedProxy | null;
/**
 * Resolve the list of candidate proxies from explicit input, global config, or env vars.
 * Rotates the starting position round-robin when multiple proxies are supplied.
 */
export declare function resolveProxyCandidates(override?: ProxyInput): ParsedProxy[];
/**
 * Resolve a single active proxy (next in rotation if a list was provided) or null if direct.
 */
export declare function resolveProxy(override?: ProxyInput): ParsedProxy | null;
/**
 * Drop-in replacement for global `fetch()` that honors explicit, global, or
 * environment-configured HTTP/HTTPS/SOCKS5 proxies (including proxy rotation pools).
 */
export declare function proxyFetch(url: string, init?: RequestInit & {
    proxy?: ProxyInput;
    timeoutMs?: number;
}): Promise<Response>;
export declare function absorbCookies(jarName: string, res: Response): void;
export declare function cookieHeader(jarName: string): string;
export declare function clearCookieJar(jarName: string): void;
export declare function hasCookies(jarName: string): boolean;
export declare function fetchTextWithJar(jarName: string, startUrl: string, deadline: number, headers?: Record<string, string>, proxyOrOpts?: ProxyInput, maybeProxy?: ProxyInput): Promise<{
    status: number;
    text: string;
    url: string;
    contentType: string;
}>;
export declare function fetchBytesWithJar(jarName: string, startUrl: string, deadline: number, headers?: Record<string, string>, maxBytes?: number, proxy?: ProxyInput): Promise<{
    status: number;
    buffer: Buffer;
    url: string;
    contentType: string;
}>;
export declare class CircuitBreaker {
    private health;
    private ladder;
    constructor(ladder?: number[]);
    isCooled(name: string): boolean;
    reportOk(name: string): void;
    reportFail(name: string, reason: string): void;
    order<T extends {
        name: string;
    }>(engines: T[], only?: string): T[];
    status(): Record<string, {
        failures: number;
        cooledRemainingMs: number;
    }>;
}
export declare class LruCache<T> {
    private maxEntries;
    private ttlMs;
    private map;
    constructor(maxEntries?: number, ttlMs?: number);
    get(key: string): T | null;
    set(key: string, val: T): void;
    clear(): void;
}
//# sourceMappingURL=http.d.ts.map