// src/utils/html.ts
// Zero-dependency HTML scanning, metadata extraction, JS-wall detection,
// and structured HTML-to-Markdown conversion.
import { clean, isHttpUrl } from './http.js';
const ENTITY_MAP = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    '#39': "'",
    '#039': "'",
    ndash: '–',
    mdash: '—',
    hellip: '…',
    copy: '©',
    reg: '®',
    trade: '™',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
    bull: '•',
    middot: '·',
};
export function decodeEntities(s) {
    return String(s || '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (whole, code) => {
        if (code[0] === '#') {
            const cp = code[1]?.toLowerCase() === 'x'
                ? parseInt(code.slice(2), 16)
                : parseInt(code.slice(1), 10);
            return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : whole;
        }
        const key = code.toLowerCase();
        return key in ENTITY_MAP ? ENTITY_MAP[key] : whole;
    });
}
/** Read one attribute's value off an HTML opening-tag string. */
export function attr(openTag, name) {
    const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]*))`, 'i');
    const m = re.exec(openTag);
    if (!m)
        return '';
    return decodeEntities(m[1] ?? m[2] ?? m[3] ?? '');
}
/** Does this opening tag carry `className` as one of its space-separated classes? */
export function hasClass(openTag, className) {
    const classes = attr(openTag, 'class').split(/\s+/);
    return classes.includes(className);
}
/** Strip tags/scripts/styles from an HTML fragment and return its visible text. */
export function textOnly(html) {
    return decodeEntities(String(html || '')
        .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}
/** Index just past the `</tag>` that balances the tag opened right before `from`. */
export function findMatchingClose(html, tag, from) {
    const pairRe = new RegExp(`<${tag}\\b[^>]*>|<\\/${tag}\\s*>`, 'gi');
    pairRe.lastIndex = from;
    let depth = 1;
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = pairRe.exec(html))) {
        if (m[0][1] === '/') {
            depth -= 1;
            if (depth === 0)
                return pairRe.lastIndex;
        }
        else {
            depth += 1;
        }
    }
    return -1;
}
/**
 * Every top-level fragment of `<tag ...>...</tag>` inside `html`,
 * optionally requiring `className` on the opening tag.
 */
export function extractTagBlocks(html, tag, className) {
    const out = [];
    const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = openRe.exec(html))) {
        const openTag = m[0];
        const start = m.index;
        if (className && !hasClass(openTag, className))
            continue;
        const end = findMatchingClose(html, tag, openRe.lastIndex);
        if (end === -1)
            continue;
        out.push(html.slice(start, end));
        openRe.lastIndex = end;
    }
    return out;
}
/**
 * The first `<tag ...>...</tag>` fragment inside `html` (optionally requiring a class).
 */
export function firstTag(html, tag, className) {
    const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = openRe.exec(html))) {
        if (className && !hasClass(m[0], className))
            continue;
        const contentStart = openRe.lastIndex;
        const afterClose = findMatchingClose(html, tag, contentStart);
        if (afterClose === -1)
            continue;
        const closeOpenIdx = html.lastIndexOf('<', afterClose - 1);
        const inner = html.slice(contentStart, closeOpenIdx > contentStart ? closeOpenIdx : contentStart);
        return { openTag: m[0], inner };
    }
    return null;
}
export function firstText(html, tag, className) {
    const hit = firstTag(html, tag, className);
    return hit ? textOnly(hit.inner) : '';
}
export function ownClassIncludes(fragment, className) {
    const m = /^<[a-z][a-z0-9]*\b[^>]*>/i.exec(fragment);
    return m ? hasClass(m[0], className) : false;
}
export function extractPageMetadata(html, fallbackUrl = '') {
    const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
    const head = headMatch ? headMatch[1] : html.slice(0, 60_000);
    const metas = new Map();
    const metaRe = /<meta\b[^>]*>/gi;
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = metaRe.exec(head))) {
        const tag = m[0];
        const name = (attr(tag, 'name') || attr(tag, 'property') || attr(tag, 'itemprop')).toLowerCase();
        const content = clean(attr(tag, 'content'));
        if (name && content && !metas.has(name)) {
            metas.set(name, content);
        }
    }
    const rawTitle = firstText(head, 'title') || metas.get('og:title') || metas.get('twitter:title') || '';
    const description = metas.get('description') ||
        metas.get('og:description') ||
        metas.get('twitter:description') ||
        '';
    let author = metas.get('author') || metas.get('article:author') || metas.get('twitter:creator') || '';
    let publishedTime = metas.get('article:published_time') ||
        metas.get('datepublished') ||
        metas.get('pubdate') ||
        metas.get('date') ||
        '';
    if (!publishedTime) {
        const timeTag = /<time\b[^>]*datetime\s*=\s*["']([^"']+)["'][^>]*>/i.exec(html);
        if (timeTag)
            publishedTime = clean(timeTag[1]);
    }
    // Check JSON-LD for datePublished / author if missing
    if (!publishedTime || !author) {
        const ldMatch = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i.exec(head);
        if (ldMatch) {
            const ldText = ldMatch[1];
            if (!publishedTime) {
                const dp = /"datePublished"\s*:\s*"([^"]+)"/i.exec(ldText);
                if (dp)
                    publishedTime = clean(dp[1]);
            }
            if (!author) {
                const au = /"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i.exec(ldText);
                if (au)
                    author = clean(au[1]);
            }
        }
    }
    let canonicalUrl = fallbackUrl;
    const linkRe = /<link\b[^>]*>/gi;
    // eslint-disable-next-line no-cond-assign
    while ((m = linkRe.exec(head))) {
        const rel = attr(m[0], 'rel').toLowerCase();
        if (rel === 'canonical') {
            const href = attr(m[0], 'href');
            if (href) {
                try {
                    canonicalUrl = fallbackUrl ? new URL(href, fallbackUrl).toString() : href;
                }
                catch {
                    canonicalUrl = href;
                }
                break;
            }
        }
    }
    const htmlOpen = /<html\b[^>]*>/i.exec(html);
    const language = htmlOpen ? attr(htmlOpen[0], 'lang') : '';
    const siteName = metas.get('og:site_name') || '';
    return {
        title: clean(rawTitle),
        description: clean(description),
        author: clean(author),
        publishedTime: clean(publishedTime),
        siteName: clean(siteName),
        canonicalUrl: clean(canonicalUrl),
        language: clean(language),
    };
}
// ── JS-Wall / SPA / Bot-Challenge Detector ──────────────────────────────────
export function detectJsRequirement(status, html) {
    if (status === 403 || status === 503 || status === 429) {
        return { needsJs: true, reason: `http_${status}` };
    }
    if (!html || html.length < 100) {
        return { needsJs: true, reason: 'empty_html' };
    }
    const lower = html.slice(0, 80_000).toLowerCase();
    if (lower.includes('cf-browser-verification') ||
        lower.includes('challenge-platform') ||
        lower.includes('<title>just a moment...</title>') ||
        lower.includes('enable javascript and cookies to continue') ||
        lower.includes('verifying you are human')) {
        return { needsJs: true, reason: 'cloudflare_or_bot_challenge' };
    }
    if (lower.includes('you need to enable javascript to run this app') ||
        lower.includes('please enable javascript to view the') ||
        lower.includes('javascript is required to view this page')) {
        const visible = textOnly(html);
        if (visible.length < 400) {
            return { needsJs: true, reason: 'spa_noscript_shell' };
        }
    }
    const visibleText = textOnly(html);
    if (visibleText.length < 160 &&
        (/id=["'](root|app|__next|__nuxt)["']/i.test(html) || /<script\b/i.test(html))) {
        return { needsJs: true, reason: 'thin_client_rendered_shell' };
    }
    return { needsJs: false };
}
const NOISE_CONTAINER_RE = /<(nav|footer|aside|menu|dialog|form|svg|canvas|iframe|noscript|script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi;
const NOISE_CLASS_ID_RE = /\b(cookie-banner|cookie-consent|gdpr|newsletter-signup|popup-modal|share-buttons|social-share|related-posts|sidebar-widget|ad-container|sponsored-content|comments-section|disqus_thread|breadcrumbs)\b/i;
function selectMainHtml(html) {
    // Strip scripts, styles, comments, and obvious non-content tags first
    let cleaned = html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style|noscript|svg|canvas|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    // Look for <article> or <main> first
    const mainBlocks = extractTagBlocks(cleaned, 'main');
    if (mainBlocks.length) {
        const joined = mainBlocks.join('\n\n');
        if (textOnly(joined).length >= 200)
            return joined;
    }
    const articleBlocks = extractTagBlocks(cleaned, 'article');
    if (articleBlocks.length) {
        const joined = articleBlocks.join('\n\n');
        if (textOnly(joined).length >= 200)
            return joined;
    }
    // Strip nav, footer, header, aside before falling back to body
    cleaned = cleaned.replace(NOISE_CONTAINER_RE, '');
    const bodyHit = firstTag(cleaned, 'body');
    const scope = bodyHit ? bodyHit.inner : cleaned;
    // Remove divs/sections with obvious noise classes/ids
    return scope.replace(/<(div|section|header)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (whole, _tag, attrs) => {
        if (NOISE_CLASS_ID_RE.test(attrs))
            return '';
        return whole;
    });
}
function resolveUrl(href, baseUrl) {
    const raw = clean(href);
    if (!raw || raw.startsWith('#') || /^javascript:|^mailto:|^tel:|^data:/i.test(raw))
        return '';
    if (isHttpUrl(raw))
        return raw;
    if (!baseUrl)
        return raw;
    try {
        return new URL(raw, baseUrl).toString();
    }
    catch {
        return '';
    }
}
function convertHtmlTableToMarkdown(tableHtml) {
    const rows = extractTagBlocks(tableHtml, 'tr');
    if (!rows.length)
        return '';
    const matrix = [];
    for (const row of rows) {
        const cells = [];
        const cellRe = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
        let m;
        // eslint-disable-next-line no-cond-assign
        while ((m = cellRe.exec(row))) {
            cells.push(textOnly(m[2]).replace(/\|/g, '\\|'));
        }
        if (cells.length)
            matrix.push(cells);
    }
    if (!matrix.length)
        return '';
    const colCount = Math.max(...matrix.map((r) => r.length));
    const normalizeRow = (r) => {
        const padded = [...r];
        while (padded.length < colCount)
            padded.push('');
        return `| ${padded.join(' | ')} |`;
    };
    const header = normalizeRow(matrix[0]);
    const divider = `| ${Array(colCount).fill('---').join(' | ')} |`;
    const body = matrix.slice(1).map(normalizeRow);
    return `\n\n${[header, divider, ...body].join('\n')}\n\n`;
}
export function htmlToMarkdown(html, options = {}) {
    const { baseUrl = '', includeLinks = true, includeImages = false, maxChars = 0, onlyMainContent = true, } = options;
    let work = onlyMainContent ? selectMainHtml(html) : html;
    work = work
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style|noscript|svg|canvas|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    const discoveredLinks = [];
    const discoveredImages = [];
    const seenLinks = new Set();
    const seenImages = new Set();
    // 1. Preserve <pre> code blocks using placeholders so whitespace is untouched
    const codeBlocks = [];
    work = work.replace(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/gi, (_whole, preAttrs, inner) => {
        const codeTag = firstTag(inner, 'code');
        const langMatch = /language-([a-z0-9_+-]+)/i.exec(`${preAttrs} ${codeTag?.openTag || ''}`);
        const lang = langMatch ? langMatch[1] : '';
        const rawCode = decodeEntities((codeTag ? codeTag.inner : inner)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')).trim();
        const idx = codeBlocks.length;
        codeBlocks.push(`\n\n\`\`\`${lang}\n${rawCode}\n\`\`\`\n\n`);
        return `__CODE_BLOCK_${idx}__`;
    });
    // 2. Convert <table> blocks
    work = work.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (tableHtml) => convertHtmlTableToMarkdown(tableHtml));
    // 3. Images
    work = work.replace(/<img\b[^>]*>/gi, (imgTag) => {
        const src = resolveUrl(attr(imgTag, 'src') || attr(imgTag, 'data-src') || attr(imgTag, 'data-original'), baseUrl);
        const alt = clean(attr(imgTag, 'alt') || attr(imgTag, 'title'));
        if (src && !seenImages.has(src)) {
            seenImages.add(src);
            discoveredImages.push({ alt, url: src });
        }
        if (!includeImages || !src)
            return '';
        return `![${alt || 'image'}](${src})`;
    });
    // 4. Links
    work = work.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_whole, aAttrs, inner) => {
        const openTag = `<a ${aAttrs}>`;
        const href = resolveUrl(attr(openTag, 'href'), baseUrl);
        const label = textOnly(inner) || clean(attr(openTag, 'aria-label')) || clean(attr(openTag, 'title'));
        if (!label)
            return '';
        if (href && !seenLinks.has(href)) {
            seenLinks.add(href);
            discoveredLinks.push({ text: label.slice(0, 160), url: href });
        }
        if (!includeLinks || !href)
            return label;
        return `[${label}](${href})`;
    });
    // 5. Headings h1-h6
    work = work.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_whole, level, inner) => {
        const hashes = '#'.repeat(Number(level));
        const text = clean(decodeEntities(inner.replace(/<[^>]+>/g, ' ')));
        return text ? `\n\n${hashes} ${text}\n\n` : '';
    });
    // 6. Blockquotes
    work = work.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_whole, inner) => {
        const text = clean(decodeEntities(inner.replace(/<[^>]+>/g, ' ')));
        return text ? `\n\n> ${text}\n\n` : '';
    });
    // 7. Inline formatting
    work = work
        .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_w, _t, inner) => {
        const t = clean(inner);
        return t ? `**${t}**` : '';
    })
        .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_w, _t, inner) => {
        const t = clean(inner);
        return t ? `*${t}*` : '';
    })
        .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_w, inner) => {
        const t = clean(decodeEntities(inner.replace(/<[^>]+>/g, '')));
        return t ? `\`${t}\`` : '';
    })
        .replace(/<(del|s)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_w, _t, inner) => {
        const t = clean(inner);
        return t ? `~~${t}~~` : '';
    });
    // 8. Lists
    work = work.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_w, inner) => {
        const t = clean(decodeEntities(inner.replace(/<[^>]+>/g, ' ')));
        return t ? `\n- ${t}` : '';
    });
    work = work.replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n\n');
    // 9. Paragraphs, breaks, horizontal rules, block elements
    work = work
        .replace(/<hr\b[^>]*\/?>/gi, '\n\n---\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?(p|div|section|article|header|main|figure|figcaption|tr|dd|dt|dl)\b[^>]*>/gi, '\n\n');
    // 10. Strip remaining HTML tags and decode entities
    work = decodeEntities(work.replace(/<[^>]+>/g, ' '));
    // Normalize horizontal spaces per line while preserving line breaks
    work = work
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    // Restore fenced code blocks
    work = work.replace(/__CODE_BLOCK_(\d+)__/g, (_w, idx) => codeBlocks[Number(idx)] || '');
    work = work.replace(/\n{3,}/g, '\n\n').trim();
    const pageTitle = firstText(html, 'title');
    if (pageTitle && work && !/^#\s+/m.test(work)) {
        work = `# ${pageTitle}\n\n${work}`;
    }
    if (maxChars > 0 && work.length > maxChars) {
        work = `${work.slice(0, maxChars).trim()}\n\n...[truncated at ${maxChars} chars]`;
    }
    return {
        markdown: work,
        links: discoveredLinks,
        images: discoveredImages,
    };
}
//# sourceMappingURL=html.js.map