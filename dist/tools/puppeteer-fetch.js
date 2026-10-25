// src/tools/puppeteer-fetch.ts
// Ultra-low-memory Headless Chromium / Puppeteer Website Fetcher for Ubuntu/Linux.
// Features:
//   - Singleton browser pool with automatic idle eviction (0 MB resting RAM)
//   - Concurrency semaphore (prevents tab explosion under parallel agent calls)
//   - Aggressive request interception (blocks images, fonts, video/audio, ads, trackers)
//   - Site-per-process disabled & V8 heap capped (--js-flags=--max-old-space-size=256)
//   - Built-in stealth evasions (navigator.webdriver, chrome runtime, plugins, languages)
//   - Automatic DOM cleanup & structured HTML-to-Markdown + metadata extraction
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { clean, DEFAULT_UA } from '../utils/http.js';
import { extractPageMetadata, htmlToMarkdown, textOnly, } from '../utils/html.js';
// ── Blocked Tracker / Ad Hosts & Resource Types ─────────────────────────────
const BLOCKED_RESOURCE_TYPES = new Set([
    'image',
    'media',
    'font',
    'texttrack',
    'eventsource',
    'websocket',
    'manifest',
    'other',
]);
const BLOCKED_HOST_RE = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|google-analytics\.com|googletagmanager\.com|googletagservices\.com|connect\.facebook\.net|facebook\.com\/tr|analytics\.tiktok\.com|hotjar\.com|clarity\.ms|sentry\.io|newrelic\.com|nr-data\.net|segment\.io|segment\.com|mixpanel\.com|adnxs\.com|criteo\.com|criteo\.net|taboola\.com|outbrain\.com|scorecardresearch\.com|quantserve\.com|adsafeprotected\.com|moatads\.com|rubiconproject\.com|pubmatic\.com|openx\.net|casalemedia\.com|amazon-adsystem\.com|chartbeat\.com|optimizely\.com|fullstory\.com|logrocket\.io|mouseflow\.com|amplitude\.com|heapanalytics\.com)$/i;
// ── Ultra-Lean Linux Chromium Flags ─────────────────────────────────────────
const LOW_MEMORY_CHROMIUM_ARGS = [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', // Essential on Ubuntu/Docker to avoid /dev/shm exhaustion
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--no-first-run',
    '--no-zygote',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    // Disabling strict site-per-process prevents spawning separate 60MB+ V8 processes per iframe
    '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process,TranslateUI,BlinkGenPropertyTrees',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--disable-translate',
    '--force-color-profile=srgb',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-default-browser-check',
    '--password-store=basic',
    '--use-mock-keychain',
    '--disk-cache-size=1',
    '--media-cache-size=1',
    '--js-flags=--max-old-space-size=256',
];
// ── Cross-Platform Chromium Binary Discovery (Ubuntu/Linux + macOS + Windows) ──
export function findBrowserExecutable() {
    const envPaths = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROME_BIN,
        process.env.CHROMIUM_PATH,
    ].filter((p) => !!p && fs.existsSync(p));
    if (envPaths.length)
        return envPaths[0];
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const candidates = [
        // Ubuntu / Debian / Alpine / Arch / Fedora / Snap / Flatpak
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/snap/bin/chromium',
        '/usr/lib/chromium/chromium',
        '/usr/lib/chromium-browser/chromium-browser',
        '/usr/bin/brave-browser',
        '/usr/bin/microsoft-edge-stable',
        '/usr/bin/microsoft-edge',
        // Windows (Chrome, Edge, Brave, Chromium)
        path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(localAppData, 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(programFiles, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
        path.join(programFilesX86, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
        path.join(localAppData, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
        path.join(localAppData, 'Chromium\\Application\\chrome.exe'),
        // macOS (Chrome, Chromium, Edge, Brave)
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }
    throw new Error('No Chromium/Chrome/Edge/Brave executable found. Install Chrome/Edge/Chromium or set PUPPETEER_EXECUTABLE_PATH.');
}
// ── Singleton Low-RAM Browser Pool Manager ──────────────────────────────────
const IDLE_TIMEOUT_MS = 45_000;
const MAX_PAGES_BEFORE_RECYCLE = 25;
const MAX_CONCURRENT_PAGES = 3;
let sharedBrowser = null;
let browserLaunchPromise = null;
let activePages = 0;
let totalPagesServed = 0;
let idleTimer = null;
let executableUsed = '';
const waitQueue = [];
function scheduleIdleClose() {
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    if (activePages === 0 && sharedBrowser) {
        idleTimer = setTimeout(async () => {
            if (activePages === 0 && sharedBrowser) {
                const b = sharedBrowser;
                sharedBrowser = null;
                await b.close().catch(() => { });
            }
        }, IDLE_TIMEOUT_MS);
        if (typeof idleTimer.unref === 'function') {
            idleTimer.unref();
        }
    }
}
async function acquireSlot() {
    if (activePages < MAX_CONCURRENT_PAGES) {
        activePages++;
        return;
    }
    await new Promise((resolve) => waitQueue.push(resolve));
    activePages++;
}
function releaseSlot() {
    activePages = Math.max(0, activePages - 1);
    const next = waitQueue.shift();
    if (next) {
        next();
    }
    else {
        scheduleIdleClose();
    }
}
async function getBrowser() {
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    if (sharedBrowser && sharedBrowser.connected) {
        if (totalPagesServed >= MAX_PAGES_BEFORE_RECYCLE && activePages <= 1) {
            const old = sharedBrowser;
            sharedBrowser = null;
            totalPagesServed = 0;
            await old.close().catch(() => { });
        }
        else {
            return sharedBrowser;
        }
    }
    if (browserLaunchPromise) {
        return browserLaunchPromise;
    }
    browserLaunchPromise = (async () => {
        try {
            executableUsed = findBrowserExecutable();
            const browser = await puppeteer.launch({
                executablePath: executableUsed,
                headless: true,
                args: LOW_MEMORY_CHROMIUM_ARGS,
                defaultViewport: { width: 1280, height: 800 },
                handleSIGINT: false,
                handleSIGTERM: false,
                handleSIGHUP: false,
            });
            browser.on('disconnected', () => {
                if (sharedBrowser === browser) {
                    sharedBrowser = null;
                }
            });
            sharedBrowser = browser;
            totalPagesServed = 0;
            return browser;
        }
        finally {
            browserLaunchPromise = null;
        }
    })();
    return browserLaunchPromise;
}
export async function closePuppeteerPool() {
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    if (sharedBrowser) {
        const b = sharedBrowser;
        sharedBrowser = null;
        await b.close().catch(() => { });
    }
}
async function applyStealthAndLowMemToPage(page, userAgent, blockResources, blockStylesheets, counters) {
    await page.setUserAgent(userAgent);
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
    });
    // Stealth evasion script injected before any document script runs
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', {
            get: () => [
                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                { name: 'Native Client', filename: 'internal-nacl-plugin' },
            ],
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win = globalThis;
        if (!win.chrome) {
            win.chrome = { runtime: {} };
        }
    });
    if (blockResources) {
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            try {
                const rType = req.resourceType();
                const rUrl = req.url();
                if (BLOCKED_RESOURCE_TYPES.has(rType) ||
                    (blockStylesheets && rType === 'stylesheet')) {
                    counters.blocked++;
                    req.abort('blockedbyclient').catch(() => { });
                    return;
                }
                if (rUrl.startsWith('data:')) {
                    counters.blocked++;
                    req.abort('blockedbyclient').catch(() => { });
                    return;
                }
                const host = new URL(rUrl).hostname;
                if (BLOCKED_HOST_RE.test(host)) {
                    counters.blocked++;
                    req.abort('blockedbyclient').catch(() => { });
                    return;
                }
                counters.allowed++;
                req.continue().catch(() => { });
            }
            catch {
                counters.allowed++;
                req.continue().catch(() => { });
            }
        });
    }
    // Dismiss any JS alert/confirm/prompt dialogs automatically so they never hang the tab
    page.on('dialog', (dialog) => {
        dialog.dismiss().catch(() => { });
    });
}
export async function fetchWithPuppeteer(options) {
    const started = Date.now();
    const targetUrl = clean(options.url);
    if (!/^https?:\/\//i.test(targetUrl)) {
        throw new Error(`Invalid http(s) URL: ${targetUrl}`);
    }
    const timeoutMs = options.timeoutMs ?? 20_000;
    const waitUntil = options.waitUntil ?? 'domcontentloaded';
    const isTakingScreenshot = Boolean(options.screenshotPath);
    const blockResources = options.blockResources ?? !isTakingScreenshot;
    const blockStylesheets = options.blockStylesheets ?? !isTakingScreenshot;
    const userAgent = options.userAgent || DEFAULT_UA;
    await acquireSlot();
    let page = null;
    const counters = { blocked: 0, allowed: 0 };
    try {
        const browser = await getBrowser();
        totalPagesServed++;
        page = await browser.newPage();
        page.setDefaultNavigationTimeout(timeoutMs);
        page.setDefaultTimeout(timeoutMs);
        await applyStealthAndLowMemToPage(page, userAgent, blockResources, blockStylesheets, counters);
        if (options.extraHeaders && Object.keys(options.extraHeaders).length) {
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                ...options.extraHeaders,
            });
        }
        if (Array.isArray(options.cookies) && options.cookies.length) {
            const domainFallback = new URL(targetUrl).hostname;
            await page.setCookie(...options.cookies.map((c) => ({
                name: c.name,
                value: c.value,
                domain: c.domain || domainFallback,
                path: c.path || '/',
            })));
        }
        let status = 200;
        try {
            const response = await page.goto(targetUrl, {
                waitUntil,
                timeout: timeoutMs,
            });
            if (response)
                status = response.status();
        }
        catch (navErr) {
            // If networkidle2 timed out because of a slow long-polling script, we still
            // keep whatever DOM has already rendered if it is non-empty!
            const msg = navErr?.message || '';
            if (!msg.toLowerCase().includes('timeout')) {
                throw navErr;
            }
        }
        // Wait briefly for hydration / dynamic JS rendering
        const waitAfter = options.waitAfterLoadMs ?? 600;
        if (waitAfter > 0) {
            await new Promise((r) => setTimeout(r, waitAfter));
        }
        if (options.waitForSelector) {
            await page
                .waitForSelector(options.waitForSelector, {
                timeout: Math.min(8_000, Math.max(2_000, timeoutMs - (Date.now() - started))),
            })
                .catch(() => { });
        }
        if (options.scrollToBottom) {
            await page
                .evaluate(async () => {
                await new Promise((resolve) => {
                    let scrolled = 0;
                    const step = 600;
                    const maxScroll = 4000;
                    const timer = setInterval(() => {
                        window.scrollBy(0, step);
                        scrolled += step;
                        if (scrolled >= maxScroll || scrolled >= document.body.scrollHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            })
                .catch(() => { });
        }
        let evaluatedResult = undefined;
        if (options.evaluateScript) {
            evaluatedResult = await page.evaluate(options.evaluateScript);
        }
        let savedScreenshotPath;
        if (options.screenshotPath) {
            savedScreenshotPath = path.resolve(options.screenshotPath);
            await fs.promises.mkdir(path.dirname(savedScreenshotPath), { recursive: true });
            await page.screenshot({
                path: savedScreenshotPath,
                fullPage: options.fullPageScreenshot ?? false,
            });
        }
        const finalUrl = page.url();
        const html = await page.content();
        // Immediately navigate to about:blank and close page to free V8/DOM memory
        await page.goto('about:blank').catch(() => { });
        await page.close().catch(() => { });
        page = null;
        const metadata = extractPageMetadata(html, finalUrl);
        const { markdown, links, images } = htmlToMarkdown(html, {
            baseUrl: finalUrl,
            includeLinks: options.includeLinks ?? true,
            includeImages: options.includeImages ?? false,
            maxChars: options.maxChars ?? 0,
            onlyMainContent: options.onlyMainContent ?? true,
        });
        return {
            url: targetUrl,
            finalUrl,
            status,
            title: metadata.title,
            metadata,
            markdown,
            textContent: textOnly(html).slice(0, options.maxChars || 100_000),
            evaluatedResult,
            screenshotPath: savedScreenshotPath,
            links,
            images,
            blockedRequestsCount: counters.blocked,
            allowedRequestsCount: counters.allowed,
            ms: Date.now() - started,
            browserExecutable: executableUsed,
        };
    }
    finally {
        if (page) {
            await page.close().catch(() => { });
        }
        releaseSlot();
        if (options.closeBrowserAfter) {
            await closePuppeteerPool();
        }
    }
}
//# sourceMappingURL=puppeteer-fetch.js.map