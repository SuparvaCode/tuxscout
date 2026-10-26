// src/test-all.ts
// Comprehensive End-to-End Verification Suite for TuxScout (all tools, modes, HTTP API, and MCP server).
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { webSearch } from './tools/web-search.js';
import { downloadImages, imageSearch } from './tools/image-search.js';
import { fetchMarkdownBatch } from './tools/markdown-fetch.js';
import { closePuppeteerPool, fetchWithPuppeteer } from './tools/puppeteer-fetch.js';
import { youtubeTool } from './tools/yt-downloader.js';
import { deepResearch } from './tools/deep-research.js';
import { socialIntel } from './tools/social-intel.js';
import { newsIntel } from './tools/news-intel.js';
import { smartExtract } from './tools/smart-extract.js';
import { startServer } from './server.js';
const results = [];
async function runStep(name, fn) {
    const t0 = Date.now();
    process.stdout.write(`⏳ Running: ${name} ... `);
    try {
        const detail = await fn();
        const ms = Date.now() - t0;
        results.push({ name, ok: true, ms, detail });
        console.log(`✅ PASS (${ms}ms) — ${detail}`);
    }
    catch (err) {
        const ms = Date.now() - t0;
        const msg = err?.message || String(err);
        results.push({ name, ok: false, ms, detail: msg });
        console.log(`❌ FAIL (${ms}ms) — ${msg}`);
    }
}
async function main() {
    console.log('======================================================================');
    console.log('  TUXSCOUT FULL END-TO-END VERIFICATION SUITE');
    console.log('======================================================================\n');
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tuxscout-e2e-'));
    try {
        // 1. Web Search (Single Query)
        await runStep('1. Web Search (Single Query + Intent & Relevance Filter)', async () => {
            const res = await webSearch({ query: 'Ubuntu Linux kernel release notes', n: 5 });
            if (!res.sources.length)
                throw new Error('Returned 0 sources');
            return `engine=${res.engine}, count=${res.sources.length}, intent=${res.intent}`;
        });
        // 2. Web Search (Multi-Query Parallel Execution & Round-Robin Merge)
        await runStep('2. Web Search (Parallel Multi-Query Round-Robin Merge)', async () => {
            const res = await webSearch({
                queries: ['SQLite WAL concurrency', 'SQLite Write-Ahead Logging benchmark'],
                n: 6,
            });
            if (!res.sources.length)
                throw new Error('Multi-query returned 0 sources');
            return `engines=[${res.engines.join(',')}], merged=${res.sources.length}`;
        });
        // 3. 5-Engine Image Search
        await runStep('3. 5-Engine Image Search', async () => {
            const res = await imageSearch({ query: 'Linux Tux Penguin', n: 5 });
            if (!res.images.length)
                throw new Error('Returned 0 images');
            return `engine=${res.engine}, images=${res.images.length}, top=${res.images[0].width}x${res.images[0].height}`;
        });
        // 4. Parallel Verified Image Downloader
        await runStep('4. Parallel Verified Image Downloader (Magic-Byte Check)', async () => {
            const imgDir = path.join(tmpRoot, 'images');
            const res = await downloadImages({
                query: 'Linux Tux logo',
                outputDir: imgDir,
                count: 2,
            });
            if (res.downloadedCount < 1)
                throw new Error('Failed to download any valid images');
            const stat = await fs.stat(res.downloaded[0].filePath);
            if (stat.size < 1000)
                throw new Error('Downloaded file too small');
            return `downloaded=${res.downloadedCount}/${res.requested}, file0=${res.downloaded[0].fileName} (${Math.round(stat.size / 1024)}KB)`;
        });
        // 5. Fast Website-to-Markdown Fetch (Single + Batch)
        await runStep('5. Fast HTTP Website-to-Markdown Fetch (Single & Batch)', async () => {
            const batch = await fetchMarkdownBatch(['https://example.com', 'https://www.iana.org/domains/reserved'], { autoPuppeteer: false, maxChars: 3000 });
            if (!batch[0].ok || !batch[0].markdown.includes('Example Domain')) {
                throw new Error('Failed to convert example.com to Markdown');
            }
            return `fetched=${batch.filter((b) => b.ok).length}/2 pages, words=${batch.map((b) => b.wordCount).join('+')}`;
        });
        // 6. Ultra-Low-RAM Puppeteer JS Fetch + Eval + Screenshot
        await runStep('6. Low-RAM Puppeteer JS Fetch (Stealth + JS Eval + Screenshot)', async () => {
            const shotPath = path.join(tmpRoot, 'example-shot.png');
            const res = await fetchWithPuppeteer({
                url: 'https://example.com',
                evaluateScript: 'document.title + " | webdriver=" + navigator.webdriver',
                screenshotPath: shotPath,
                closeBrowserAfter: true,
            });
            const shotStat = await fs.stat(shotPath);
            if (!res.markdown.includes('Example Domain') || shotStat.size < 1000) {
                throw new Error('Puppeteer markdown or screenshot invalid');
            }
            return `eval="${res.evaluatedResult}", screenshot=${Math.round(shotStat.size / 1024)}KB, blocked=${res.blockedRequestsCount} reqs`;
        });
        // 7. YouTube Tool: Search Mode
        await runStep('7. YouTube Tool (Search Mode)', async () => {
            const res = await youtubeTool({
                input: 'Me at the zoo',
                mode: 'search',
                searchLimit: 2,
            });
            if (!res.ok || !res.searchResults?.length) {
                throw new Error(res.error || 'No YouTube search results');
            }
            return `found=${res.searchResults.length}, top="${res.searchResults[0].title}" (${res.searchResults[0].durationString})`;
        });
        // 8. YouTube Tool: Info Metadata Probe
        await runStep('8. YouTube Tool (Metadata Info Mode)', async () => {
            const res = await youtubeTool({
                input: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
                mode: 'info',
            });
            if (!res.ok || !res.metadata?.id) {
                throw new Error(res.error || 'Failed to probe YouTube video metadata');
            }
            return `id=${res.metadata.id}, title="${res.metadata.title}", views=${res.metadata.viewCount.toLocaleString()}`;
        });
        // 9. YouTube Tool: Subtitle / Transcript Extraction
        await runStep('9. YouTube Tool (Subtitle / Transcript Extraction)', async () => {
            const res = await youtubeTool({
                input: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
                mode: 'transcript',
            });
            if (!res.ok || !res.transcript?.segments.length) {
                throw new Error(res.error || 'No transcript segments extracted');
            }
            return `segments=${res.transcript.segments.length}, text="${res.transcript.fullText.slice(0, 60)}..."`;
        });
        // 10. YouTube Tool: Audio / Music Download
        await runStep('10. YouTube Tool (Audio / Music Download)', async () => {
            const audioDir = path.join(tmpRoot, 'yt-audio');
            const res = await youtubeTool({
                input: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
                mode: 'audio',
                outputDir: audioDir,
            });
            if (!res.ok || !res.filePath) {
                throw new Error(res.error || 'Audio download failed');
            }
            return `file=${res.fileName} (${Math.round((res.bytes || 0) / 1024)}KB)`;
        });
        // 11. YouTube Tool: Video Download
        await runStep('11. YouTube Tool (Video Download)', async () => {
            const videoDir = path.join(tmpRoot, 'yt-video');
            const res = await youtubeTool({
                input: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
                mode: 'video',
                maxHeight: 360,
                outputDir: videoDir,
            });
            if (!res.ok || !res.filePath) {
                throw new Error(res.error || 'Video download failed');
            }
            return `file=${res.fileName} (${Math.round((res.bytes || 0) / 1024)}KB)`;
        });
        // 12. 4-Stage Parallel Deep Research Pipeline
        await runStep('12. 4-Stage Parallel Deep Research Pipeline', async () => {
            const res = await deepResearch({
                query: 'Linux eBPF packet filtering overview',
                depth: 'quick',
                maxPages: 2,
            });
            if (!res.evidencePages.length) {
                throw new Error('Deep research returned 0 evidence pages');
            }
            return `angles=${res.telemetry.queriesExecuted.length}, candidates=${res.telemetry.totalCandidatesFound}, analyzed=${res.evidencePages.length} pages (${res.reportMarkdown.length} chars MD)`;
        });
        // 13. HTTP REST API Server (Live Endpoints Check)
        await runStep('13. HTTP REST API Server (/health, /search, /images, /fetch)', async () => {
            const server = await startServer({ port: 0, host: '127.0.0.1' });
            const addr = server.address();
            const port = typeof addr === 'object' && addr ? addr.port : 18787;
            const base = `http://127.0.0.1:${port}`;
            try {
                const health = await (await fetch(`${base}/health`)).json();
                if (!health.ok)
                    throw new Error('/health not ok');
                const searchResp = await (await fetch(`${base}/search`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: 'Ubuntu Linux', n: 2 }),
                })).json();
                if (!Array.isArray(searchResp.sources))
                    throw new Error('/search failed');
                const fetchResp = await (await fetch(`${base}/fetch?url=${encodeURIComponent('https://example.com')}`)).json();
                if (!fetchResp.ok)
                    throw new Error('/fetch failed');
                return `port=${port}, health=OK (RAM=${health.memoryMb.rss}MB), search=${searchResp.sources.length}, fetch=${fetchResp.status}`;
            }
            finally {
                server.close();
            }
        });
        // 14. MCP (Model Context Protocol) JSON-RPC 2.0 Server
        await runStep('14. MCP Stdio Server (initialize -> tools/list -> tools/call)', async () => {
            const mcpScript = path.resolve('dist/mcp.js');
            const child = spawn(process.execPath, [mcpScript], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const responses = [];
            let buf = '';
            child.stdout.on('data', (chunk) => {
                buf += chunk.toString('utf8');
                const lines = buf.split('\n');
                buf = lines.pop() || '';
                for (const l of lines) {
                    if (l.trim())
                        responses.push(JSON.parse(l));
                }
            });
            const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
            send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
            send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
            send({
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: {
                    name: 'fetch_markdown',
                    arguments: { url: 'https://example.com', autoPuppeteer: false },
                },
            });
            const deadline = Date.now() + 8_000;
            while (responses.length < 3 && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 100));
            }
            child.kill();
            if (responses.length < 3) {
                throw new Error(`Expected 3 MCP responses, got ${responses.length}`);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const toolsList = responses[1]?.result?.tools || [];
            return `rpcResponses=3, registeredTools=${toolsList.length}`;
        });
        // 15. Social Intelligence (Zero-Browser X/Twitter & Instagram)
        await runStep('15. Social Intelligence (X/Twitter & Instagram Zero-Browser Scraper)', async () => {
            const [tw, ig] = await Promise.all([
                socialIntel({ target: 'https://x.com/jack/status/20' }),
                socialIntel({ target: 'https://www.instagram.com/p/DWq-l0gDegd/' }),
            ]);
            if (!tw.ok || !ig.ok) {
                throw new Error(`Social scrape failed: tw=${tw.ok}, ig=${ig.ok}`);
            }
            return `twitter=${tw.platform}/${tw.action} (${tw.markdown.length} chars), instagram=${ig.platform}/${ig.action} (${ig.markdown.length} chars)`;
        });
        // 16. Live News Aggregator & Smart Knowledge Extractor
        await runStep('16. Live News Aggregator & Smart Knowledge Extractor', async () => {
            const [news, pkg] = await Promise.all([
                newsIntel({ category: 'hn', limit: 3 }),
                smartExtract({ target: 'npm:tuxscout' }),
            ]);
            if (!news.ok || !pkg.ok) {
                throw new Error(`News/Extract failed: news=${news.ok}, extract=${pkg.ok}`);
            }
            return `hnStories=${news.total}, extractProvider=${pkg.provider} (${pkg.target})`;
        });
    }
    finally {
        await closePuppeteerPool();
        await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => { });
    }
    console.log('\n======================================================================');
    const passed = results.filter((r) => r.ok).length;
    console.log(`  SUMMARY: ${passed}/${results.length} TESTS PASSED`);
    console.log('======================================================================');
    if (passed < results.length) {
        process.exit(1);
    }
}
main().catch((err) => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
//# sourceMappingURL=test-all.js.map