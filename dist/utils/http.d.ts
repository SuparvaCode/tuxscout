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
export declare function absorbCookies(jarName: string, res: Response): void;
export declare function cookieHeader(jarName: string): string;
export declare function clearCookieJar(jarName: string): void;
export declare function hasCookies(jarName: string): boolean;
export declare function fetchTextWithJar(jarName: string, startUrl: string, deadline: number, headers?: Record<string, string>): Promise<{
    status: number;
    text: string;
    url: string;
    contentType: string;
}>;
export declare function fetchBytesWithJar(jarName: string, startUrl: string, deadline: number, headers?: Record<string, string>, maxBytes?: number): Promise<{
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