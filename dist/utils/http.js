// src/utils/http.ts
// Shared zero-dependency HTTP client with manual redirect following, per-engine
// cookie jars, TLS drop retry, circuit breaker, and LRU caching.
export const DEFAULT_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const API_UA = 'AgentToolsPack/1.0 (+https://southasia-one.kognare.com; Linux x86_64)';
export const BROWSER_HEADERS = {
    'User-Agent': DEFAULT_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Ch-Ua': '"Chromium";v="140", "Google Chrome";v="140", "Not;A=Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Linux"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
};
export class EngineError extends Error {
    reason;
    status;
    constructor(reason, status = 0, message) {
        super(message || reason);
        this.name = 'EngineError';
        this.reason = reason;
        this.status = status;
    }
}
export const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const isHttpUrl = (u) => /^https?:\/\//i.test(u);
export const num = (v) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
};
export function hostOf(u) {
    try {
        return new URL(u).hostname.replace(/^www\./i, '');
    }
    catch {
        return '';
    }
}
// ── Cookie Jar + Manual Redirects ───────────────────────────────────────────
const jars = new Map();
export function absorbCookies(jarName, res) {
    let jar = jars.get(jarName);
    if (!jar) {
        jar = new Map();
        jars.set(jarName, jar);
    }
    const headers = res.headers;
    const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const raw of list) {
        const pair = raw.split(';')[0];
        const i = pair.indexOf('=');
        if (i <= 0)
            continue;
        const name = pair.slice(0, i).trim();
        const value = pair.slice(i + 1).trim();
        if (value)
            jar.set(name, value);
        else
            jar.delete(name);
    }
}
export function cookieHeader(jarName) {
    const jar = jars.get(jarName);
    if (!jar || !jar.size)
        return '';
    return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}
export function clearCookieJar(jarName) {
    jars.delete(jarName);
}
export function hasCookies(jarName) {
    return (jars.get(jarName)?.size ?? 0) > 0;
}
export async function fetchTextWithJar(jarName, startUrl, deadline, headers = BROWSER_HEADERS) {
    let url = startUrl;
    let transportRetries = 1;
    for (let hop = 0; hop < 6; hop++) {
        const remaining = deadline - Date.now();
        if (remaining <= 250) {
            throw new EngineError('timeout', 0, 'time budget exhausted');
        }
        const cookie = cookieHeader(jarName);
        let res;
        try {
            res = await fetch(url, {
                headers: cookie ? { ...headers, Cookie: cookie } : headers,
                redirect: 'manual',
                signal: AbortSignal.timeout(remaining),
            });
        }
        catch (err) {
            const e = err;
            const reason = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'transport';
            if (reason === 'transport' && transportRetries > 0 && deadline - Date.now() > 1_000) {
                transportRetries -= 1;
                hop -= 1;
                await new Promise((r) => setTimeout(r, 150));
                continue;
            }
            const cause = e?.cause?.message ? ` (${clean(e.cause.message)})` : '';
            let host = 'unknown';
            try {
                host = new URL(url).hostname;
            }
            catch { /* ignore */ }
            throw new EngineError(reason, 0, `${host}: ${clean(e?.message)}${cause}`.slice(0, 200));
        }
        absorbCookies(jarName, res);
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
            await res.body?.cancel().catch(() => { });
            url = new URL(location, url).toString();
            continue;
        }
        const contentType = res.headers.get('content-type') || '';
        const text = await res.text().catch(() => '');
        return { status: res.status, text, url, contentType };
    }
    throw new EngineError('redirect_loop', 0, 'too many redirects');
}
export async function fetchBytesWithJar(jarName, startUrl, deadline, headers = BROWSER_HEADERS, maxBytes = 50 * 1024 * 1024) {
    let url = startUrl;
    let transportRetries = 1;
    for (let hop = 0; hop < 6; hop++) {
        const remaining = deadline - Date.now();
        if (remaining <= 250) {
            throw new EngineError('timeout', 0, 'download time budget exhausted');
        }
        const cookie = cookieHeader(jarName);
        let res;
        try {
            res = await fetch(url, {
                headers: cookie ? { ...headers, Cookie: cookie } : headers,
                redirect: 'manual',
                signal: AbortSignal.timeout(remaining),
            });
        }
        catch (err) {
            const e = err;
            const reason = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'transport';
            if (reason === 'transport' && transportRetries > 0 && deadline - Date.now() > 1_000) {
                transportRetries -= 1;
                hop -= 1;
                await new Promise((r) => setTimeout(r, 150));
                continue;
            }
            throw new EngineError(reason, 0, clean(e?.message).slice(0, 200));
        }
        absorbCookies(jarName, res);
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location) {
            await res.body?.cancel().catch(() => { });
            url = new URL(location, url).toString();
            continue;
        }
        const contentLength = Number(res.headers.get('content-length') || 0);
        if (contentLength > maxBytes) {
            await res.body?.cancel().catch(() => { });
            throw new EngineError('too_large', res.status, `Content-Length ${contentLength} exceeds maxBytes ${maxBytes}`);
        }
        const contentType = res.headers.get('content-type') || '';
        const ab = await res.arrayBuffer();
        if (ab.byteLength > maxBytes) {
            throw new EngineError('too_large', res.status, `Payload ${ab.byteLength} exceeds maxBytes ${maxBytes}`);
        }
        return { status: res.status, buffer: Buffer.from(ab), url, contentType };
    }
    throw new EngineError('redirect_loop', 0, 'too many redirects');
}
// ── Per-Engine Circuit Breaker ──────────────────────────────────────────────
const DEFAULT_COOLDOWN_LADDER_MS = [30_000, 120_000, 300_000, 900_000];
export class CircuitBreaker {
    health = new Map();
    ladder;
    constructor(ladder = DEFAULT_COOLDOWN_LADDER_MS) {
        this.ladder = ladder;
    }
    isCooled(name) {
        const h = this.health.get(name);
        return !!h && h.until > Date.now();
    }
    reportOk(name) {
        this.health.delete(name);
    }
    reportFail(name, reason) {
        const h = this.health.get(name) || { failures: 0, until: 0 };
        h.failures += reason === 'timeout' || reason === 'transport' ? 0.5 : 1;
        const idx = Math.min(Math.max(0, Math.ceil(h.failures) - 1), this.ladder.length - 1);
        h.until = Date.now() + this.ladder[idx];
        this.health.set(name, h);
    }
    order(engines, only) {
        if (only) {
            const pinned = engines.filter((e) => e.name === only);
            if (pinned.length)
                return pinned;
        }
        const fresh = engines.filter((e) => !this.isCooled(e.name));
        const cooled = engines.filter((e) => this.isCooled(e.name));
        return fresh.concat(cooled);
    }
    status() {
        const out = {};
        const now = Date.now();
        for (const [k, v] of this.health.entries()) {
            out[k] = { failures: v.failures, cooledRemainingMs: Math.max(0, v.until - now) };
        }
        return out;
    }
}
// ── Simple In-Memory LRU Cache ──────────────────────────────────────────────
export class LruCache {
    maxEntries;
    ttlMs;
    map = new Map();
    constructor(maxEntries = 300, ttlMs = 10 * 60_000) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
    }
    get(key) {
        const hit = this.map.get(key);
        if (!hit)
            return null;
        if (Date.now() - hit.at > this.ttlMs) {
            this.map.delete(key);
            return null;
        }
        this.map.delete(key);
        this.map.set(key, hit);
        return hit.val;
    }
    set(key, val) {
        if (this.map.size >= this.maxEntries) {
            const oldest = this.map.keys().next().value;
            if (oldest !== undefined)
                this.map.delete(oldest);
        }
        this.map.set(key, { at: Date.now(), val });
    }
    clear() {
        this.map.clear();
    }
}
//# sourceMappingURL=http.js.map