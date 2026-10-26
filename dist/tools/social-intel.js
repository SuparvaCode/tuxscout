// src/tools/social-intel.ts
// Zero-Browser Social Media Reconnaissance & Structured Scraping Suite for AI Agents.
// Supports:
//   - Twitter / X : Single Tweet/Thread, User Profile + Recent Tweets, Topic/Keyword Search
//   - Instagram   : User Profile + Recent Posts/Reels Grid, Single Post/Reel Inspector, Topic Search
//   - Reddit      : Subreddit Feed (hot/new/top), Post + Nested Comments, User Profile, Search
//   - GitHub      : Repository Overview + README, Issue/PR Thread, User Profile, Trending Repos
//   - TikTok      : Video & Creator Metadata via oEmbed + Crawler Meta
import { BROWSER_HEADERS, clean, fetchTextWithJar, hasCookies, LruCache, } from '../utils/http.js';
import { attr, decodeEntities, extractPageMetadata, textOnly } from '../utils/html.js';
import { webSearch } from './web-search.js';
const cache = new LruCache(200, 5 * 60_000);
const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const REDDIT_RSS_UA = 'Feedbin feed-id:98412 - 12 subscribers';
function parseCompactCount(raw) {
    if (!raw)
        return 0;
    const cleaned = raw.replace(/,/g, '').trim().toUpperCase();
    const m = /^([\d.]+)\s*([KMB])?$/.exec(cleaned);
    if (!m) {
        const n = Number(cleaned.replace(/[^\d.]/g, ''));
        return Number.isFinite(n) ? Math.round(n) : 0;
    }
    const base = parseFloat(m[1]);
    const mult = m[2] === 'B' ? 1_000_000_000 : m[2] === 'M' ? 1_000_000 : m[2] === 'K' ? 1_000 : 1;
    return Math.round(base * mult);
}
function extractMetaMap(html) {
    const metas = new Map();
    const metaRe = /<meta\b[^>]*>/gi;
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = metaRe.exec(html))) {
        const tag = m[0];
        const name = (attr(tag, 'property') ||
            attr(tag, 'name') ||
            attr(tag, 'itemprop')).toLowerCase();
        const content = decodeEntities(attr(tag, 'content')).trim();
        if (name && content && !metas.has(name)) {
            metas.set(name, content);
        }
    }
    return metas;
}
// ── 1. TWITTER / X SCRAPER (Zero-Browser via FxTwitter + VxTwitter + Syndication) ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFxTweet(t) {
    const mediaList = [];
    const allMedia = t?.media?.all || t?.media?.photos || [];
    for (const m of allMedia) {
        mediaList.push({
            type: m.type || 'photo',
            url: m.url,
            thumbnailUrl: m.thumbnail_url,
            width: m.width,
            height: m.height,
            durationSec: m.duration,
        });
    }
    if (!mediaList.length && Array.isArray(t?.media?.videos)) {
        for (const v of t.media.videos) {
            mediaList.push({
                type: 'video',
                url: v.url,
                thumbnailUrl: v.thumbnail_url,
                width: v.width,
                height: v.height,
                durationSec: v.duration,
            });
        }
    }
    return {
        id: String(t.id || ''),
        url: t.url || `https://x.com/${t.author?.screen_name || 'i'}/status/${t.id}`,
        text: String(t.text || t.raw_text?.text || '').trim(),
        createdAt: String(t.created_at || ''),
        lang: t.lang,
        author: {
            name: String(t.author?.name || t.author?.screen_name || ''),
            username: String(t.author?.screen_name || ''),
            url: t.author?.url || `https://x.com/${t.author?.screen_name || ''}`,
            avatarUrl: t.author?.avatar_url,
            followers: typeof t.author?.followers === 'number' ? t.author.followers : undefined,
            following: typeof t.author?.following === 'number' ? t.author.following : undefined,
        },
        stats: {
            views: typeof t.views === 'number' ? t.views : null,
            likes: Number(t.likes || 0),
            retweets: Number(t.retweets || 0),
            replies: Number(t.replies || 0),
            bookmarks: typeof t.bookmarks === 'number' ? t.bookmarks : undefined,
        },
        media: mediaList,
        quotedTweet: t.quote
            ? {
                id: String(t.quote.id || ''),
                authorUsername: String(t.quote.author?.screen_name || ''),
                text: String(t.quote.text || ''),
                url: t.quote.url ||
                    `https://x.com/${t.quote.author?.screen_name || 'i'}/status/${t.quote.id}`,
            }
            : undefined,
        poll: t.poll
            ? {
                totalVotes: Number(t.poll.total_votes || 0),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                choices: (t.poll.choices || []).map((c) => ({
                    label: String(c.label || ''),
                    count: Number(c.count || 0),
                    percentage: Number(c.percentage || 0),
                })),
            }
            : undefined,
    };
}
export async function fetchTwitterTweet(tweetIdOrUrl, userHint = 'i') {
    let id = tweetIdOrUrl.trim();
    let user = userHint;
    const m = /(?:twitter\.com|x\.com)\/([^/?#]+)\/status\/(\d+)/i.exec(id);
    if (m) {
        user = m[1];
        id = m[2];
    }
    else {
        const idOnly = /(\d{5,25})/.exec(id);
        if (idOnly)
            id = idOnly[1];
    }
    if (!/^\d+$/.test(id))
        return null;
    // Primary: FxTwitter API
    try {
        const res = await fetch(`https://api.fxtwitter.com/${user}/status/${id}`, {
            headers: { 'User-Agent': 'TuxScout/1.1 (+https://github.com/SuparvaCode/tuxscout)' },
            signal: AbortSignal.timeout(6_000),
        });
        if (res.ok) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = await res.json();
            if (data?.tweet) {
                return mapFxTweet(data.tweet);
            }
        }
    }
    catch {
        /* fallback */
    }
    // Fallback 1: VxTwitter API
    try {
        const res = await fetch(`https://api.vxtwitter.com/${user}/status/${id}`, {
            headers: { 'User-Agent': 'TuxScout/1.1' },
            signal: AbortSignal.timeout(6_000),
        });
        if (res.ok) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const d = await res.json();
            if (d?.text !== undefined) {
                return {
                    id: String(d.tweetID || id),
                    url: d.tweetURL || `https://x.com/${d.user_screen_name || user}/status/${id}`,
                    text: String(d.text || ''),
                    createdAt: String(d.date || ''),
                    lang: d.lang,
                    author: {
                        name: String(d.user_name || ''),
                        username: String(d.user_screen_name || user),
                        url: `https://x.com/${d.user_screen_name || user}`,
                        avatarUrl: d.user_profile_image_url,
                    },
                    stats: {
                        views: null,
                        likes: Number(d.likes || 0),
                        retweets: Number(d.retweets || 0),
                        replies: Number(d.replies || 0),
                    },
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    media: (d.media_extended || []).map((m) => ({
                        type: m.type || 'photo',
                        url: m.url,
                        thumbnailUrl: m.thumbnail_url,
                        width: m.size?.width,
                        height: m.size?.height,
                    })),
                };
            }
        }
    }
    catch {
        /* fallback */
    }
    // Fallback 2: Official Twitter Syndication API
    try {
        const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=x`, {
            headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] },
            signal: AbortSignal.timeout(6_000),
        });
        if (res.ok) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const s = await res.json();
            if (s?.text) {
                return {
                    id: String(s.id_str || id),
                    url: `https://x.com/${s.user?.screen_name || user}/status/${id}`,
                    text: String(s.text || ''),
                    createdAt: String(s.created_at || ''),
                    lang: s.lang,
                    author: {
                        name: String(s.user?.name || ''),
                        username: String(s.user?.screen_name || user),
                        url: `https://x.com/${s.user?.screen_name || user}`,
                        avatarUrl: s.user?.profile_image_url_https,
                        verified: Boolean(s.user?.is_blue_verified || s.user?.verified),
                    },
                    stats: {
                        views: null,
                        likes: Number(s.favorite_count || 0),
                        retweets: Number(s.retweet_count || 0),
                        replies: Number(s.conversation_count || 0),
                    },
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    media: (s.mediaDetails || []).map((m) => ({
                        type: m.type || 'photo',
                        url: m.media_url_https,
                    })),
                };
            }
        }
    }
    catch {
        /* ignore */
    }
    return null;
}
export async function fetchTwitterProfile(usernameOrUrl, limit = 6) {
    let username = usernameOrUrl
        .trim()
        .replace(/^@/, '')
        .replace(/^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\//i, '')
        .split(/[/?#]/)[0];
    if (!username)
        return null;
    let profile = null;
    // 1. Fetch profile metadata from FxTwitter
    try {
        const res = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(username)}`, {
            headers: { 'User-Agent': 'TuxScout/1.1 (+https://github.com/SuparvaCode/tuxscout)' },
            signal: AbortSignal.timeout(6_000),
        });
        if (res.ok) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = await res.json();
            if (data?.user) {
                const u = data.user;
                username = u.screen_name || username;
                profile = {
                    username,
                    name: String(u.name || username),
                    url: u.url || `https://x.com/${username}`,
                    bio: String(u.description || ''),
                    location: u.location || undefined,
                    website: u.website?.url || undefined,
                    joinedAt: u.joined || undefined,
                    followers: Number(u.followers || 0),
                    following: Number(u.following || 0),
                    tweetsCount: Number(u.tweets || 0),
                    likesCount: typeof u.likes === 'number' ? u.likes : undefined,
                    mediaCount: typeof u.media_count === 'number' ? u.media_count : undefined,
                    avatarUrl: u.avatar_url || undefined,
                    bannerUrl: u.banner_url || undefined,
                    recentTweets: [],
                };
            }
        }
    }
    catch {
        /* fallback to vxtwitter */
    }
    // Fallback to VxTwitter profile
    if (!profile) {
        try {
            const res = await fetch(`https://api.vxtwitter.com/${encodeURIComponent(username)}`, {
                headers: { 'User-Agent': 'TuxScout/1.1' },
                signal: AbortSignal.timeout(6_000),
            });
            if (res.ok) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const u = await res.json();
                if (u?.screen_name) {
                    username = u.screen_name;
                    profile = {
                        username,
                        name: String(u.name || username),
                        url: `https://x.com/${username}`,
                        bio: String(u.description || ''),
                        location: u.location || undefined,
                        joinedAt: u.created_at || undefined,
                        followers: Number(u.followers_count || 0),
                        following: Number(u.following_count || 0),
                        tweetsCount: Number(u.statuses_count || 0),
                        avatarUrl: u.profile_image_url || undefined,
                        bannerUrl: u.profile_banner_url || undefined,
                        recentTweets: [],
                    };
                }
            }
        }
        catch {
            /* ignore */
        }
    }
    // 2. Discover and hydrate recent tweets for this user in parallel
    if (limit > 0) {
        try {
            const searchRes = await webSearch({
                queries: [
                    `site:x.com/${username}/status OR site:twitter.com/${username}/status`,
                    `"x.com/${username}/status"`,
                ],
                n: Math.min(20, limit * 3),
            });
            const seenIds = new Set();
            const candidates = [];
            for (const s of searchRes.sources) {
                const m = /(?:twitter\.com|x\.com)\/([^/?#]+)\/status\/(\d+)/i.exec(s.url);
                if (m && m[1].toLowerCase() === username.toLowerCase() && !seenIds.has(m[2])) {
                    seenIds.add(m[2]);
                    candidates.push({ user: m[1], id: m[2] });
                }
            }
            // Sort Snowflake IDs descending so newest tweets come first
            candidates.sort((a, b) => {
                try {
                    const ba = BigInt(a.id);
                    const bb = BigInt(b.id);
                    return bb > ba ? 1 : bb < ba ? -1 : 0;
                }
                catch {
                    return 0;
                }
            });
            const topCandidates = candidates.slice(0, limit);
            const hydrated = await Promise.all(topCandidates.map((c) => fetchTwitterTweet(c.id, c.user)));
            const validTweets = hydrated.filter((t) => Boolean(t));
            if (profile) {
                profile.recentTweets = validTweets;
            }
            else if (validTweets.length > 0) {
                const a = validTweets[0].author;
                profile = {
                    username: a.username || username,
                    name: a.name || username,
                    url: `https://x.com/${a.username || username}`,
                    bio: '',
                    followers: a.followers || 0,
                    following: a.following || 0,
                    tweetsCount: 0,
                    avatarUrl: a.avatarUrl,
                    recentTweets: validTweets,
                };
            }
        }
        catch {
            /* keep profile metadata even if timeline search fails */
        }
    }
    return profile;
}
export async function searchTwitterTweets(query, limit = 8) {
    const searchRes = await webSearch({
        queries: [
            `(site:x.com OR site:twitter.com) "status" ${query}`,
            `site:x.com/*/status ${query}`,
        ],
        n: Math.min(25, limit * 3),
    });
    const seenIds = new Set();
    const candidates = [];
    for (const s of searchRes.sources) {
        const m = /(?:twitter\.com|x\.com)\/([^/?#]+)\/status\/(\d+)/i.exec(s.url);
        if (m && !seenIds.has(m[2])) {
            seenIds.add(m[2]);
            candidates.push({ user: m[1], id: m[2] });
        }
    }
    const hydrated = await Promise.all(candidates.slice(0, limit + 3).map((c) => fetchTwitterTweet(c.id, c.user)));
    return hydrated.filter((t) => Boolean(t)).slice(0, limit);
}
// ── 2. INSTAGRAM SCRAPER (Zero-Browser Profile + Post/Reel Inspector) ──────
export async function fetchInstagramPost(urlOrShortcode) {
    let shortcode = urlOrShortcode.trim();
    let type = 'post';
    const m = /instagram\.com\/(?:[^/?#]+\/)?(p|reel|tv)\/([A-Za-z0-9_-]+)/i.exec(shortcode);
    if (m) {
        type = m[1].toLowerCase() === 'reel' ? 'reel' : 'post';
        shortcode = m[2];
    }
    else {
        shortcode = shortcode.replace(/^\/+|\/+$/g, '');
    }
    if (!/^[A-Za-z0-9_-]{5,25}$/.test(shortcode))
        return null;
    const targetUrl = `https://www.instagram.com/p/${shortcode}/`;
    try {
        const res = await fetch(targetUrl, {
            headers: {
                'User-Agent': CRAWLER_UA,
                Accept: 'text/html,application/xhtml+xml',
            },
            signal: AbortSignal.timeout(7_000),
        });
        if (!res.ok)
            return null;
        const html = await res.text();
        const metas = extractMetaMap(html);
        const ogTitle = metas.get('og:title') || '';
        const twTitle = metas.get('twitter:title') || '';
        const desc = metas.get('description') || metas.get('og:description') || '';
        const ogUrl = metas.get('og:url') || targetUrl;
        const imageUrl = metas.get('og:image') || metas.get('twitter:image') || undefined;
        const videoUrl = metas.get('og:video') || metas.get('og:video:secure_url') || undefined;
        if (ogUrl.includes('/reel/'))
            type = 'reel';
        // Extract author username and full name
        // e.g. twitter:title = "NASA (@nasa) • Instagram photos and videos"
        // or og:url = "https://www.instagram.com/nasa/p/DWq-l0gDegd/"
        let authorUsername = '';
        let authorFullName = '';
        const twUserMatch = /^(.+?)\s*\(@([A-Za-z0-9._]+)\)/i.exec(twTitle);
        if (twUserMatch) {
            authorFullName = clean(twUserMatch[1]);
            authorUsername = clean(twUserMatch[2]);
        }
        if (!authorUsername) {
            const urlUserMatch = /instagram\.com\/([A-Za-z0-9._]+)\/(?:p|reel)\//i.exec(ogUrl);
            if (urlUserMatch && !['p', 'reel', 'tv', 'explore'].includes(urlUserMatch[1].toLowerCase())) {
                authorUsername = urlUserMatch[1];
            }
        }
        if (!authorFullName) {
            const ogAuthorMatch = /^(.+?)\s+on\s+Instagram:/i.exec(ogTitle);
            if (ogAuthorMatch)
                authorFullName = clean(ogAuthorMatch[1]);
        }
        // Extract likes, comments, date, and caption from description / og:title
        // Pattern A (end of description): "... - 3M likes, 21K comments - @nasa on April 3, 2026"
        // Pattern B (start of description): "3M likes, 21K comments - nasa on April 3, 2026: \"...\""
        let likesRaw;
        let commentsRaw;
        let publishedAt;
        let caption = '';
        const tailStatsMatch = /-\s*([\d,.]+[KMB]?)\s+likes?,\s*([\d,.]+[KMB]?)\s+comments?\s*-\s*@?([A-Za-z0-9._]+)\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*$/i.exec(desc);
        const headStatsMatch = /^([\d,.]+[KMB]?)\s+likes?,\s*([\d,.]+[KMB]?)\s+comments?\s*-\s*@?([A-Za-z0-9._]+)\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*:\s*([\s\S]*)$/i.exec(desc);
        if (tailStatsMatch) {
            likesRaw = tailStatsMatch[1];
            commentsRaw = tailStatsMatch[2];
            if (!authorUsername)
                authorUsername = tailStatsMatch[3];
            publishedAt = tailStatsMatch[4];
            caption = desc.slice(0, tailStatsMatch.index).trim();
        }
        else if (headStatsMatch) {
            likesRaw = headStatsMatch[1];
            commentsRaw = headStatsMatch[2];
            if (!authorUsername)
                authorUsername = headStatsMatch[3];
            publishedAt = headStatsMatch[4];
            caption = headStatsMatch[5].replace(/^["“]|["”]\.?$/g, '').trim();
        }
        else {
            const ogCaptionMatch = /on\s+Instagram:\s*["“]([\s\S]*?)["”]\.?$/i.exec(ogTitle);
            caption = ogCaptionMatch ? ogCaptionMatch[1].trim() : desc;
        }
        caption = caption.replace(/^["“]|["”]\.?$/g, '').trim();
        if (!caption && !imageUrl && !authorUsername)
            return null;
        return {
            shortcode,
            url: ogUrl || targetUrl,
            type,
            authorUsername: authorUsername || 'unknown',
            authorFullName: authorFullName || undefined,
            caption,
            likesRaw,
            likesCount: likesRaw ? parseCompactCount(likesRaw) : undefined,
            commentsRaw,
            commentsCount: commentsRaw ? parseCompactCount(commentsRaw) : undefined,
            publishedAt,
            imageUrl,
            videoUrl,
        };
    }
    catch {
        return null;
    }
}
export async function fetchInstagramProfile(usernameOrUrl, limit = 6) {
    const username = usernameOrUrl
        .trim()
        .replace(/^@/, '')
        .replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, '')
        .split(/[/?#]/)[0];
    if (!username || ['p', 'reel', 'tv', 'explore'].includes(username.toLowerCase())) {
        return null;
    }
    const profileUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;
    let fullName = username;
    let biography = '';
    let followersRaw = '0';
    let followingRaw = '0';
    let postsRaw = '0';
    let avatarUrl;
    try {
        const res = await fetch(profileUrl, {
            headers: {
                'User-Agent': CRAWLER_UA,
                Accept: 'text/html,application/xhtml+xml',
            },
            signal: AbortSignal.timeout(7_000),
        });
        if (res.ok) {
            const html = await res.text();
            const metas = extractMetaMap(html);
            const ogTitle = metas.get('og:title') || '';
            const ogDesc = metas.get('og:description') || '';
            const metaDesc = metas.get('description') || ogDesc;
            avatarUrl = metas.get('og:image') || undefined;
            // og:title: "NASA (@nasa) • Instagram photos and videos"
            const titleMatch = /^(.+?)\s*\(@([A-Za-z0-9._]+)\)/i.exec(ogTitle);
            if (titleMatch) {
                fullName = clean(titleMatch[1]);
            }
            // metaDesc: '104M Followers, 94 Following, 4,979 Posts - NASA (@nasa) on Instagram: "Making the seemingly impossible, possible. ✨"'
            const statsMatch = /([\d,.]+[KMB]?)\s+Followers?,\s*([\d,.]+[KMB]?)\s+Following,\s*([\d,.]+[KMB]?)\s+Posts?/i.exec(metaDesc);
            if (statsMatch) {
                followersRaw = statsMatch[1];
                followingRaw = statsMatch[2];
                postsRaw = statsMatch[3];
            }
            const bioMatch = /on\s+Instagram:\s*["“]([\s\S]*?)["”]$/i.exec(metaDesc);
            if (bioMatch) {
                biography = bioMatch[1].trim();
            }
        }
    }
    catch {
        /* continue to post discovery */
    }
    const recentPosts = [];
    if (limit > 0) {
        try {
            const searchRes = await webSearch({
                queries: [
                    `site:instagram.com/${username}/p/ OR site:instagram.com/${username}/reel/`,
                    `site:instagram.com/p/ "@${username}"`,
                    `site:instagram.com/reel/ "@${username}"`,
                ],
                n: Math.min(24, limit * 3),
            });
            const seenCodes = new Set();
            const codes = [];
            for (const s of searchRes.sources) {
                const m = /instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i.exec(s.url);
                if (m && !seenCodes.has(m[1])) {
                    seenCodes.add(m[1]);
                    codes.push(m[1]);
                }
            }
            const hydrated = await Promise.all(codes.slice(0, limit + 6).map((code) => fetchInstagramPost(code)));
            for (const post of hydrated) {
                if (!post)
                    continue;
                // Prefer posts authored by this user when authorUsername is known
                if (post.authorUsername &&
                    post.authorUsername !== 'unknown' &&
                    post.authorUsername.toLowerCase() !== username.toLowerCase()) {
                    continue;
                }
                recentPosts.push(post);
                if (recentPosts.length >= limit)
                    break;
            }
            // If strict username filter filtered out everything (e.g. collaborations), include valid posts
            if (recentPosts.length === 0) {
                for (const post of hydrated) {
                    if (post)
                        recentPosts.push(post);
                    if (recentPosts.length >= limit)
                        break;
                }
            }
        }
        catch {
            /* ignore */
        }
    }
    return {
        username,
        fullName,
        url: profileUrl,
        biography,
        followersRaw,
        followersCount: parseCompactCount(followersRaw),
        followingRaw,
        followingCount: parseCompactCount(followingRaw),
        postsRaw,
        postsCount: parseCompactCount(postsRaw),
        avatarUrl,
        recentPosts,
    };
}
export async function searchInstagramPosts(query, limit = 6) {
    const searchRes = await webSearch({
        queries: [
            `(site:instagram.com/p/ OR site:instagram.com/reel/) ${query}`,
        ],
        n: Math.min(20, limit * 3),
    });
    const seenCodes = new Set();
    const codes = [];
    for (const s of searchRes.sources) {
        const m = /instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i.exec(s.url);
        if (m && !seenCodes.has(m[1])) {
            seenCodes.add(m[1]);
            codes.push(m[1]);
        }
    }
    const hydrated = await Promise.all(codes.slice(0, limit + 4).map((c) => fetchInstagramPost(c)));
    return hydrated.filter((p) => Boolean(p)).slice(0, limit);
}
// ── 3. REDDIT SCRAPER (Cookie-Bootstrapped Atom RSS for Subreddits, Posts & Comments) ──
async function fetchRedditRss(rssUrl) {
    const deadline = Date.now() + 9_000;
    if (!hasCookies('reddit_jar')) {
        await fetchTextWithJar('reddit_jar', 'https://old.reddit.com/', deadline, BROWSER_HEADERS).catch(() => { });
    }
    const res = await fetchTextWithJar('reddit_jar', rssUrl, deadline, {
        'User-Agent': REDDIT_RSS_UA,
        Accept: 'application/atom+xml,application/rss+xml,application/xml,text/xml',
    });
    return res.text;
}
function parseRedditAtomEntries(xml) {
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((m) => m[1]);
    return entries.map((e) => {
        const id = clean(e.match(/<id>([\s\S]*?)<\/id>/i)?.[1] || '');
        const title = decodeEntities(clean(e.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ''));
        const author = clean(e.match(/<name>([\s\S]*?)<\/name>/i)?.[1] || '');
        const subreddit = clean(e.match(/<category[^>]+label="([^"]+)"/i)?.[1] || '');
        const link = clean(e.match(/<link\s+href="([^"]+)"/i)?.[1] || '');
        const updated = clean(e.match(/<updated>([\s\S]*?)<\/updated>/i)?.[1] || '');
        const rawContent = decodeEntities(e.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] || '');
        const extMatch = /<a\s+href="([^"]+)">\[link\]<\/a>/i.exec(rawContent);
        const externalUrl = extMatch && !extMatch[1].includes('reddit.com/r/') ? extMatch[1] : undefined;
        const contentText = textOnly(rawContent
            .replace(/&#32;\s*submitted by[\s\S]*$/i, '')
            .replace(/\[link\]|\[comments\]/gi, ''));
        return {
            id,
            title,
            author,
            subreddit,
            link,
            externalUrl,
            updated,
            contentText,
        };
    });
}
export async function fetchRedditSubreddit(subredditInput, sort = 'hot', limit = 10) {
    const sub = subredditInput
        .trim()
        .replace(/^\/?r\//i, '')
        .replace(/^https?:\/\/(?:www\.|old\.)?reddit\.com\/r\//i, '')
        .split(/[/?#]/)[0];
    const validSort = ['hot', 'new', 'top', 'rising'].includes(sort.toLowerCase())
        ? sort.toLowerCase()
        : 'hot';
    const rssUrl = `https://www.reddit.com/r/${encodeURIComponent(sub)}/${validSort}/.rss?limit=${Math.min(50, limit)}`;
    const xml = await fetchRedditRss(rssUrl);
    const parsed = parseRedditAtomEntries(xml);
    return parsed.slice(0, limit).map((p) => ({
        id: p.id,
        title: p.title,
        author: p.author,
        subreddit: p.subreddit || `r/${sub}`,
        url: p.link,
        externalUrl: p.externalUrl,
        publishedAt: p.updated,
        bodyText: p.contentText.slice(0, 1200),
    }));
}
export async function fetchRedditPostWithComments(postUrl, limit = 12) {
    const cleanUrl = postUrl.split('?')[0].replace(/\/+$/, '');
    const rssUrl = `${cleanUrl}/.rss?limit=${Math.min(50, limit + 2)}`;
    const xml = await fetchRedditRss(rssUrl);
    const parsed = parseRedditAtomEntries(xml);
    if (!parsed.length)
        return { post: null, comments: [] };
    const op = parsed[0];
    const post = {
        id: op.id,
        title: op.title,
        author: op.author,
        subreddit: op.subreddit,
        url: op.link || cleanUrl,
        externalUrl: op.externalUrl,
        publishedAt: op.updated,
        bodyText: op.contentText.slice(0, 3000),
    };
    const comments = parsed.slice(1, limit + 1).map((c) => ({
        author: c.author,
        publishedAt: c.updated,
        bodyText: c.contentText.slice(0, 1500),
        permalink: c.link,
    }));
    return { post, comments };
}
export async function searchReddit(query, limit = 10) {
    const rssUrl = `https://www.reddit.com/search.rss?q=${encodeURIComponent(query)}&sort=relevance&t=year&limit=${Math.min(50, limit)}`;
    const xml = await fetchRedditRss(rssUrl);
    const parsed = parseRedditAtomEntries(xml);
    return parsed.slice(0, limit).map((p) => ({
        id: p.id,
        title: p.title,
        author: p.author,
        subreddit: p.subreddit,
        url: p.link,
        externalUrl: p.externalUrl,
        publishedAt: p.updated,
        bodyText: p.contentText.slice(0, 1000),
    }));
}
// ── 4. GITHUB SCRAPER (Repo + README, Issue/PR Thread, User, Trending) ─────
const GITHUB_API_HEADERS = {
    'User-Agent': 'TuxScout/1.1 (+https://github.com/SuparvaCode/tuxscout)',
    Accept: 'application/vnd.github+json',
};
export async function fetchGithubRepo(repoOrUrl) {
    const cleanPath = repoOrUrl
        .trim()
        .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
        .replace(/\.git$/i, '')
        .split(/[?#]/)[0]
        .replace(/^\/+|\/+$/g, '');
    const [owner, repo] = cleanPath.split('/');
    if (!owner || !repo)
        throw new Error(`Invalid GitHub repository: ${repoOrUrl}`);
    const [repoRes, releasesRes, readmeRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: GITHUB_API_HEADERS,
            signal: AbortSignal.timeout(7_000),
        }),
        fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=3`, {
            headers: GITHUB_API_HEADERS,
            signal: AbortSignal.timeout(7_000),
        }),
        fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
            headers: { ...GITHUB_API_HEADERS, Accept: 'application/vnd.github.raw+json' },
            signal: AbortSignal.timeout(7_000),
        }),
    ]);
    if (!repoRes.ok) {
        throw new Error(`GitHub API returned HTTP ${repoRes.status} for ${owner}/${repo}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await repoRes.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const releases = releasesRes.ok ? await releasesRes.json() : [];
    const readmeRaw = readmeRes.ok ? await readmeRes.text() : '';
    return {
        fullName: r.full_name,
        url: r.html_url,
        description: r.description || '',
        homepage: r.homepage || undefined,
        stars: Number(r.stargazers_count || 0),
        forks: Number(r.forks_count || 0),
        watchers: Number(r.subscribers_count || 0),
        openIssues: Number(r.open_issues_count || 0),
        language: r.language || 'Unknown',
        license: r.license?.spdx_id || r.license?.name || undefined,
        topics: r.topics || [],
        defaultBranch: r.default_branch || 'main',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        pushedAt: r.pushed_at,
        latestReleases: Array.isArray(releases)
            ? releases.slice(0, 3).map((rel) => ({
                tag: rel.tag_name,
                name: rel.name,
                publishedAt: rel.published_at,
                url: rel.html_url,
            }))
            : [],
        readmeExcerpt: readmeRaw.slice(0, 3500),
    };
}
export async function fetchGithubIssueOrPr(issueUrlOrPath, limit = 10) {
    const cleanPath = issueUrlOrPath
        .trim()
        .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
        .split(/[?#]/)[0]
        .replace(/^\/+|\/+$/g, '');
    const m = /^([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/i.exec(cleanPath);
    if (!m)
        throw new Error(`Invalid GitHub Issue/PR URL: ${issueUrlOrPath}`);
    const [, owner, repo, kind, num] = m;
    const [itemRes, commentsRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${num}`, {
            headers: GITHUB_API_HEADERS,
            signal: AbortSignal.timeout(7_000),
        }),
        fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${num}/comments?per_page=${Math.min(30, limit)}`, {
            headers: GITHUB_API_HEADERS,
            signal: AbortSignal.timeout(7_000),
        }),
    ]);
    if (!itemRes.ok) {
        throw new Error(`GitHub Issue/PR HTTP ${itemRes.status}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = await itemRes.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comments = commentsRes.ok ? await commentsRes.json() : [];
    return {
        repo: `${owner}/${repo}`,
        number: Number(num),
        type: kind === 'pull' || item.pull_request ? 'pull_request' : 'issue',
        title: item.title,
        state: item.state,
        author: item.user?.login,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        labels: (item.labels || []).map((l) => l.name),
        url: item.html_url,
        body: String(item.body || '').slice(0, 3500),
        commentsCount: Number(item.comments || 0),
        comments: Array.isArray(comments)
            ? comments.slice(0, limit).map((c) => ({
                author: c.user?.login,
                createdAt: c.created_at,
                body: String(c.body || '').slice(0, 1200),
            }))
            : [],
    };
}
export async function fetchGithubTrending(language = '', since = 'daily', limit = 10) {
    const validSince = ['daily', 'weekly', 'monthly'].includes(since.toLowerCase())
        ? since.toLowerCase()
        : 'daily';
    const langSegment = language ? `/${encodeURIComponent(language.toLowerCase())}` : '';
    const url = `https://github.com/trending${langSegment}?since=${validSince}`;
    const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(8_000),
    });
    const html = await res.text();
    const rows = [...html.matchAll(/<article\s+class="Box-row"[^>]*>([\s\S]*?)<\/article>/gi)].map((m) => m[1]);
    return rows.slice(0, limit).map((row) => {
        const h2Block = row.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '';
        const repoHref = h2Block.match(/<a\s+[^>]*href="\/([^"?#]+)"/i)?.[1] || '';
        const fullName = repoHref.replace(/\s+/g, '');
        const description = textOnly(row.match(/<p\s+class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
        const lang = textOnly(row.match(/itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
        const starsTotalRaw = textOnly(row.match(/href="\/[^"]+\/stargazers"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '');
        const starsPeriodRaw = textOnly(row.match(/class="d-inline-block float-sm-right"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
        return {
            fullName,
            url: `https://github.com/${fullName}`,
            description,
            language: lang || language || 'Unknown',
            stars: parseCompactCount(starsTotalRaw),
            starsInPeriod: starsPeriodRaw,
            period: validSince,
        };
    });
}
// ── 5. TIKTOK SCRAPER (Zero-Browser oEmbed + Metadata) ─────────────────────
export async function fetchTiktokInfo(url) {
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl, {
        headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] },
        signal: AbortSignal.timeout(7_000),
    });
    if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = await res.json();
        return {
            url,
            title: d.title || '',
            authorName: d.author_name || '',
            authorUsername: d.author_unique_id || '',
            authorUrl: d.author_url || '',
            thumbnailUrl: d.thumbnail_url || '',
            provider: 'TikTok',
        };
    }
    const pageRes = await fetch(url, {
        headers: { 'User-Agent': CRAWLER_UA },
        signal: AbortSignal.timeout(7_000),
    });
    const html = await pageRes.text();
    const meta = extractPageMetadata(html, url);
    return {
        url,
        title: meta.title,
        description: meta.description,
        authorName: meta.author,
        provider: 'TikTok',
    };
}
// ── MARKDOWN FORMATTERS FOR CONCISE AI AGENT CONSUMPTION ───────────────────
function formatTweetMd(t, index) {
    const prefix = index !== undefined ? `### ${index + 1}. ` : '### ';
    const lines = [
        `${prefix}@${t.author.username} (${t.author.name})`,
        `- **URL:** ${t.url}`,
        `- **Posted:** ${t.createdAt}`,
        `- **Stats:** ❤️ ${t.stats.likes.toLocaleString()} | 🔁 ${t.stats.retweets.toLocaleString()} | 💬 ${t.stats.replies.toLocaleString()}${t.stats.views ? ` | 👁️ ${t.stats.views.toLocaleString()} views` : ''}`,
        '',
        t.text,
    ];
    if (t.quotedTweet) {
        lines.push('', `> **Quoted @${t.quotedTweet.authorUsername}:** ${t.quotedTweet.text} (${t.quotedTweet.url})`);
    }
    if (t.media.length) {
        lines.push('', '**Media:**');
        for (const m of t.media) {
            lines.push(`- [${m.type.toUpperCase()}](${m.url})`);
        }
    }
    return lines.join('\n');
}
function formatInstagramPostMd(p, index) {
    const prefix = index !== undefined ? `### ${index + 1}. ` : '### ';
    const lines = [
        `${prefix}Instagram ${p.type.toUpperCase()} by @${p.authorUsername}${p.authorFullName ? ` (${p.authorFullName})` : ''}`,
        `- **URL:** ${p.url}`,
    ];
    if (p.publishedAt)
        lines.push(`- **Date:** ${p.publishedAt}`);
    if (p.likesRaw || p.commentsRaw) {
        lines.push(`- **Engagement:** ❤️ ${p.likesRaw || '0'} likes | 💬 ${p.commentsRaw || '0'} comments`);
    }
    if (p.imageUrl)
        lines.push(`- **Image:** ${p.imageUrl}`);
    if (p.videoUrl)
        lines.push(`- **Video:** ${p.videoUrl}`);
    if (p.caption) {
        lines.push('', p.caption);
    }
    return lines.join('\n');
}
// ── AUTO-DETECTION & UNIFIED ENTRYPOINT ────────────────────────────────────
export function detectSocialPlatformAndAction(target, platformHint = 'auto', actionHint = 'auto') {
    const t = target.trim();
    let platform = platformHint;
    let action = actionHint;
    if (platform === 'auto') {
        if (/(?:twitter\.com|x\.com)\//i.test(t) || /^twitter:/i.test(t) || /^x:/i.test(t)) {
            platform = 'twitter';
        }
        else if (/instagram\.com\//i.test(t) || /^ig:/i.test(t) || /^insta:/i.test(t)) {
            platform = 'instagram';
        }
        else if (/reddit\.com\//i.test(t) || /^\/?r\/[A-Za-z0-9_]+/i.test(t) || /^reddit:/i.test(t)) {
            platform = 'reddit';
        }
        else if (/github\.com\//i.test(t) || /^gh:/i.test(t) || /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(t)) {
            platform = 'github';
        }
        else if (/tiktok\.com\//i.test(t)) {
            platform = 'tiktok';
        }
        else {
            platform = 'twitter';
        }
    }
    if (action === 'auto') {
        if (platform === 'twitter') {
            if (/\/status\/\d+/i.test(t) || /^\d{10,25}$/.test(t))
                action = 'post';
            else if (/^@?[A-Za-z0-9_]{1,15}$/.test(t) || /(?:twitter\.com|x\.com)\/[A-Za-z0-9_]+\/?$/i.test(t)) {
                action = 'profile';
            }
            else {
                action = 'search';
            }
        }
        else if (platform === 'instagram') {
            if (/\/(?:p|reel|tv)\/[A-Za-z0-9_-]+/i.test(t))
                action = 'post';
            else if (/^@?[A-Za-z0-9._]{1,30}$/.test(t) ||
                /instagram\.com\/[A-Za-z0-9._]+\/?$/i.test(t)) {
                action = 'profile';
            }
            else {
                action = 'search';
            }
        }
        else if (platform === 'reddit') {
            if (/\/comments\/[a-z0-9]+/i.test(t))
                action = 'post';
            else if (/^\/?r\/[A-Za-z0-9_]+$/i.test(t) || /reddit\.com\/r\/[A-Za-z0-9_]+\/?$/i.test(t)) {
                action = 'feed';
            }
            else {
                action = 'search';
            }
        }
        else if (platform === 'github') {
            if (t.toLowerCase().includes('trending') || t === 'gh:trending')
                action = 'trending';
            else if (/\/(issues|pull)\/\d+/i.test(t))
                action = 'issue';
            else
                action = 'repo';
        }
        else {
            action = 'post';
        }
    }
    return { platform, action };
}
export async function socialIntel(options) {
    const started = Date.now();
    const limit = Math.max(1, Math.min(25, Number(options.limit || 8)));
    const rawTarget = clean(options.target)
        .replace(/^(twitter|x|ig|insta|reddit|gh):/i, '')
        .trim();
    const { platform, action } = detectSocialPlatformAndAction(options.target, options.platform || 'auto', options.action || 'auto');
    const cacheKey = `${platform}:${action}:${rawTarget}:${limit}:${options.sort || ''}:${options.language || ''}`;
    if (!options.noCache) {
        const hit = cache.get(cacheKey);
        if (hit) {
            return { ...hit, cached: true, ms: Date.now() - started };
        }
    }
    try {
        let data = null;
        let markdown = '';
        if (platform === 'twitter') {
            if (action === 'post') {
                const tweet = await fetchTwitterTweet(rawTarget);
                if (!tweet)
                    throw new Error(`Tweet not found or unavailable: ${rawTarget}`);
                data = tweet;
                markdown = `# X / Twitter Post\n\n${formatTweetMd(tweet)}`;
            }
            else if (action === 'profile') {
                const prof = await fetchTwitterProfile(rawTarget, limit);
                if (!prof)
                    throw new Error(`Twitter profile not found: ${rawTarget}`);
                data = prof;
                const lines = [
                    `# X / Twitter Profile: ${prof.name} (@${prof.username})`,
                    `- **URL:** ${prof.url}`,
                    `- **Bio:** ${prof.bio || 'N/A'}`,
                    `- **Followers:** ${prof.followers.toLocaleString()} | **Following:** ${prof.following.toLocaleString()} | **Tweets:** ${prof.tweetsCount.toLocaleString()}`,
                ];
                if (prof.location)
                    lines.push(`- **Location:** ${prof.location}`);
                if (prof.website)
                    lines.push(`- **Website:** ${prof.website}`);
                if (prof.joinedAt)
                    lines.push(`- **Joined:** ${prof.joinedAt}`);
                if (prof.recentTweets.length) {
                    lines.push('', `## Recent Posts (${prof.recentTweets.length})`, '');
                    prof.recentTweets.forEach((t, i) => {
                        lines.push(formatTweetMd(t, i), '');
                    });
                }
                markdown = lines.join('\n');
            }
            else {
                const tweets = await searchTwitterTweets(rawTarget, limit);
                data = { query: rawTarget, count: tweets.length, tweets };
                const lines = [`# X / Twitter Search: "${rawTarget}" (${tweets.length} tweets)\n`];
                tweets.forEach((t, i) => lines.push(formatTweetMd(t, i), ''));
                markdown = lines.join('\n');
            }
        }
        else if (platform === 'instagram') {
            if (action === 'post') {
                const post = await fetchInstagramPost(rawTarget);
                if (!post)
                    throw new Error(`Instagram post/reel not found: ${rawTarget}`);
                data = post;
                markdown = `# Instagram ${post.type.toUpperCase()}\n\n${formatInstagramPostMd(post)}`;
            }
            else if (action === 'profile') {
                const prof = await fetchInstagramProfile(rawTarget, limit);
                if (!prof)
                    throw new Error(`Instagram profile not found: ${rawTarget}`);
                data = prof;
                const lines = [
                    `# Instagram Profile: ${prof.fullName} (@${prof.username})`,
                    `- **URL:** ${prof.url}`,
                    `- **Followers:** ${prof.followersRaw} (${prof.followersCount.toLocaleString()}) | **Following:** ${prof.followingRaw} | **Posts:** ${prof.postsRaw}`,
                    `- **Bio:** ${prof.biography || 'N/A'}`,
                ];
                if (prof.avatarUrl)
                    lines.push(`- **Avatar:** ${prof.avatarUrl}`);
                if (prof.recentPosts.length) {
                    lines.push('', `## Recent Posts & Reels (${prof.recentPosts.length})`, '');
                    prof.recentPosts.forEach((p, i) => lines.push(formatInstagramPostMd(p, i), ''));
                }
                markdown = lines.join('\n');
            }
            else {
                const posts = await searchInstagramPosts(rawTarget, limit);
                data = { query: rawTarget, count: posts.length, posts };
                const lines = [`# Instagram Search: "${rawTarget}" (${posts.length} posts/reels)\n`];
                posts.forEach((p, i) => lines.push(formatInstagramPostMd(p, i), ''));
                markdown = lines.join('\n');
            }
        }
        else if (platform === 'reddit') {
            if (action === 'post') {
                const res = await fetchRedditPostWithComments(rawTarget, limit);
                if (!res.post)
                    throw new Error(`Reddit post not found: ${rawTarget}`);
                data = res;
                const lines = [
                    `# Reddit Thread: ${res.post.title}`,
                    `- **Subreddit:** ${res.post.subreddit} | **Author:** ${res.post.author} | **Posted:** ${res.post.publishedAt}`,
                    `- **URL:** ${res.post.url}`,
                    '',
                    res.post.bodyText || '*(Link post)*',
                    '',
                    `## Top Comments (${res.comments.length})`,
                    '',
                ];
                res.comments.forEach((c, i) => {
                    lines.push(`### ${i + 1}. ${c.author} (${c.publishedAt})\n${c.bodyText}\n`);
                });
                markdown = lines.join('\n');
            }
            else if (action === 'feed') {
                const posts = await fetchRedditSubreddit(rawTarget, options.sort || 'hot', limit);
                data = { subreddit: rawTarget, sort: options.sort || 'hot', posts };
                const lines = [`# Reddit Subreddit Feed: ${rawTarget} (${posts.length} posts)\n`];
                posts.forEach((p, i) => {
                    lines.push(`### ${i + 1}. ${p.title}`, `- **Author:** ${p.author} | **Posted:** ${p.publishedAt}`, `- **Link:** ${p.url}${p.externalUrl ? ` | **External:** ${p.externalUrl}` : ''}`, p.bodyText ? `\n${p.bodyText.slice(0, 350)}\n` : '');
                });
                markdown = lines.join('\n');
            }
            else {
                const posts = await searchReddit(rawTarget, limit);
                data = { query: rawTarget, posts };
                const lines = [`# Reddit Search: "${rawTarget}" (${posts.length} threads)\n`];
                posts.forEach((p, i) => {
                    lines.push(`### ${i + 1}. [${p.subreddit}] ${p.title}`, `- **Author:** ${p.author} | **Posted:** ${p.publishedAt}`, `- **URL:** ${p.url}`, p.bodyText ? `\n${p.bodyText.slice(0, 350)}\n` : '');
                });
                markdown = lines.join('\n');
            }
        }
        else if (platform === 'github') {
            if (action === 'trending') {
                const repos = await fetchGithubTrending(options.language || '', options.sort || 'daily', limit);
                data = { language: options.language || 'all', since: options.sort || 'daily', repos };
                const lines = [
                    `# GitHub Trending Repositories (${options.language || 'All Languages'}, ${options.sort || 'daily'})\n`,
                ];
                repos.forEach((r, i) => {
                    lines.push(`${i + 1}. **[${r.fullName}](${r.url})** (${r.language}) — ⭐ ${r.stars.toLocaleString()} (${r.starsInPeriod})`, `   ${r.description}`, '');
                });
                markdown = lines.join('\n');
            }
            else if (action === 'issue') {
                const issue = await fetchGithubIssueOrPr(rawTarget, limit);
                data = issue;
                const lines = [
                    `# GitHub ${issue.type === 'pull_request' ? 'PR' : 'Issue'} #${issue.number}: ${issue.title}`,
                    `- **Repo:** ${issue.repo} | **State:** ${issue.state.toUpperCase()} | **Author:** @${issue.author}`,
                    `- **URL:** ${issue.url}`,
                    '',
                    issue.body,
                    '',
                    `## Comments (${issue.comments.length}/${issue.commentsCount})`,
                    '',
                ];
                issue.comments.forEach((c, i) => {
                    lines.push(`### ${i + 1}. @${c.author} (${c.createdAt})\n${c.body}\n`);
                });
                markdown = lines.join('\n');
            }
            else {
                const repo = await fetchGithubRepo(rawTarget);
                data = repo;
                const lines = [
                    `# GitHub Repo: ${repo.fullName}`,
                    `- **URL:** ${repo.url}`,
                    `- **Description:** ${repo.description}`,
                    `- **Stats:** ⭐ ${repo.stars.toLocaleString()} | 🍴 ${repo.forks.toLocaleString()} | 🐛 ${repo.openIssues.toLocaleString()} open issues`,
                    `- **Language:** ${repo.language} | **License:** ${repo.license || 'N/A'}`,
                    repo.topics.length ? `- **Topics:** ${repo.topics.join(', ')}` : '',
                ].filter(Boolean);
                if (repo.latestReleases.length) {
                    lines.push('', '## Latest Releases', ...repo.latestReleases.map((rel) => `- **${rel.tag}** (${rel.name || rel.tag}) — ${rel.publishedAt}`));
                }
                if (repo.readmeExcerpt) {
                    lines.push('', '## README Excerpt', '', repo.readmeExcerpt);
                }
                markdown = lines.join('\n');
            }
        }
        else if (platform === 'tiktok') {
            const tk = await fetchTiktokInfo(rawTarget);
            data = tk;
            markdown = [
                `# TikTok Video`,
                `- **Author:** ${tk.authorName} (@${tk.authorUsername || ''})`,
                `- **URL:** ${tk.url}`,
                `- **Caption:** ${tk.title}`,
            ].join('\n');
        }
        const result = {
            ok: true,
            platform,
            action,
            target: rawTarget,
            data,
            markdown,
            ms: Date.now() - started,
        };
        cache.set(cacheKey, result);
        return { ...result, cached: false };
    }
    catch (err) {
        return {
            ok: false,
            platform,
            action,
            target: rawTarget,
            data: null,
            markdown: '',
            cached: false,
            ms: Date.now() - started,
            error: err?.message || String(err),
        };
    }
}
//# sourceMappingURL=social-intel.js.map