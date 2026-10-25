// src/tools/yt-downloader.ts
// Full-featured YouTube Video, Music/Audio, Search, Info, and Transcript/Subtitle tool
// powered by yt-dlp + ffmpeg with automatic binary discovery and self-bootstrap.

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clean, DEFAULT_UA, fetchBytesWithJar, fetchTextWithJar, isHttpUrl } from '../utils/http.js';
import { decodeEntities } from '../utils/html.js';

export type YtMode = 'video' | 'audio' | 'transcript' | 'info' | 'search';
export type YtVideoType = 'long' | 'shorts' | 'all';
export type AudioFormat = 'mp3' | 'm4a' | 'opus' | 'wav' | 'flac' | 'best';
export type VideoFormat = 'mp4' | 'mkv' | 'webm';

export interface YtVideoMetadata {
  id: string;
  title: string;
  url: string;
  channel: string;
  channelUrl?: string;
  duration: number;
  durationString: string;
  viewCount: number;
  likeCount?: number;
  uploadDate: string;
  thumbnail: string;
  description: string;
  isShort: boolean;
  categories?: string[];
  tags?: string[];
}

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  timestamp: string;
  text: string;
}

export interface YtToolOptions {
  /** YouTube URL, 11-char video ID, OR search query (e.g. "lofi hip hop" or "https://www.youtube.com/watch?v=...") */
  input: string;
  mode?: YtMode;
  outputDir?: string;
  /** For mode='audio': mp3 (default), m4a, opus, wav, flac, best */
  audioFormat?: AudioFormat;
  /** For mode='video': mp4 (default), mkv, webm */
  videoFormat?: VideoFormat;
  /** Max video resolution height: 2160, 1440, 1080 (default), 720, 480, 360 */
  maxHeight?: number;
  /** Number of results when mode='search' (default 5) */
  searchLimit?: number;
  /** Filter search results by video type: 'long' (default, excludes Shorts), 'shorts' (Shorts only), or 'all' */
  videoType?: YtVideoType;
  /** Subtitle language code for mode='transcript' (default 'en') */
  subLang?: string;
  /** Optional path to Netscape cookies.txt for age-restricted / premium videos */
  cookiesFile?: string;
  /** Embed thumbnail & metadata into audio file (default true if ffmpeg present) */
  embedMetadata?: boolean;
  /** Custom filename template or prefix */
  filenamePrefix?: string;
  /** Max execution timeout in ms (default 180_000 for downloads, 30_000 for info/search) */
  timeoutMs?: number;
}

export interface YtToolResult {
  mode: YtMode;
  input: string;
  ok: boolean;
  filePath?: string;
  fileName?: string;
  bytes?: number;
  metadata?: YtVideoMetadata;
  searchResults?: YtVideoMetadata[];
  transcript?: {
    language: string;
    fullText: string;
    markdown: string;
    segments: TranscriptSegment[];
  };
  ytDlpBinary: string;
  ffmpegAvailable: boolean;
  ms: number;
  error?: string;
}

// ── Binary Discovery & Auto-Bootstrap (Windows + Linux + macOS) ─────────────
function whichSync(cmd: string): string | null {
  const isWin = process.platform === 'win32';
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extraDirs = isWin
    ? [
        path.join(os.homedir(), '.tuxscout', 'bin'),
        path.join(os.homedir(), '.agent-tools', 'bin'),
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\WinGet\\Links'),
        path.join(os.homedir(), 'scoop', 'shims'),
        'C:\\ProgramData\\chocolatey\\bin',
        'C:\\ffmpeg\\bin',
      ]
    : [
        path.join(os.homedir(), '.tuxscout', 'bin'),
        path.join(os.homedir(), '.agent-tools', 'bin'),
        path.join(os.homedir(), '.local', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/snap/bin',
      ];

  for (const dir of [...extraDirs, ...pathDirs]) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, `${cmd}${ext}`);
      if (fsSync.existsSync(full)) {
        try {
          const st = fsSync.statSync(full);
          if (st.isFile()) return full;
        } catch {
          /* ignore */
        }
      }
    }
  }

  // Also scan WinGet Packages folder on Windows for Gyan.FFmpeg / yt-dlp if not yet in PATH
  if (isWin && (cmd === 'ffmpeg' || cmd === 'yt-dlp')) {
    const wingetPkgDir = path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\WinGet\\Packages');
    if (fsSync.existsSync(wingetPkgDir)) {
      try {
        const pkgs = fsSync.readdirSync(wingetPkgDir);
        const matchPkg = pkgs.find((p) =>
          cmd === 'ffmpeg' ? /ffmpeg/i.test(p) : /yt-dlp/i.test(p),
        );
        if (matchPkg) {
          const pkgRoot = path.join(wingetPkgDir, matchPkg);
          const directExe = path.join(pkgRoot, `${cmd}.exe`);
          if (fsSync.existsSync(directExe)) return directExe;
          const subDirs = fsSync.readdirSync(pkgRoot);
          for (const sub of subDirs) {
            const candidate = path.join(pkgRoot, sub, 'bin', `${cmd}.exe`);
            if (fsSync.existsSync(candidate)) return candidate;
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  return null;
}

export function findFfmpegBinary(): string | null {
  if (process.env.FFMPEG_PATH && fsSync.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  return whichSync('ffmpeg');
}

export function hasFfmpeg(): boolean {
  return Boolean(findFfmpegBinary());
}

export async function ensureYtDlp(): Promise<string> {
  if (process.env.YT_DLP_PATH && fsSync.existsSync(process.env.YT_DLP_PATH)) {
    return process.env.YT_DLP_PATH;
  }
  const existing = whichSync('yt-dlp');
  if (existing) return existing;

  // Auto-download standalone yt-dlp binary to ~/.tuxscout/bin
  const binDir = path.join(os.homedir(), '.tuxscout', 'bin');
  await fs.mkdir(binDir, { recursive: true });
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const arch = os.arch();

  let assetName = 'yt-dlp_linux';
  if (isWin) assetName = arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe';
  else if (isMac) assetName = 'yt-dlp_macos';
  else if (arch === 'arm64' || arch === 'aarch64') assetName = 'yt-dlp_linux_aarch64';

  const targetPath = path.join(binDir, isWin ? 'yt-dlp.exe' : 'yt-dlp');
  const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;

  const { status, buffer } = await fetchBytesWithJar(
    'ytdlp-bootstrap',
    downloadUrl,
    Date.now() + 60_000,
    { 'User-Agent': 'TuxScout/1.0' },
    60 * 1024 * 1024,
  );
  if (status >= 400 || buffer.length < 100_000) {
    throw new Error(
      `Failed to auto-download yt-dlp from ${downloadUrl} (HTTP ${status}). Run "tuxscout setup" or install yt-dlp manually.`,
    );
  }
  await fs.writeFile(targetPath, buffer);
  if (!isWin) {
    await fs.chmod(targetPath, 0o755);
  }
  return targetPath;
}

function runProcess(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`yt-dlp timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function extractYoutubeVideoId(input: string): string | null {
  const s = clean(input);
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})(?:$|[&#])/,
    /youtu\.be\/([A-Za-z0-9_-]{11})(?:$|[?&#/])/,
    /youtube\.com\/(?:shorts|embed|v|live)\/([A-Za-z0-9_-]{11})(?:$|[?&#/])/,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) return m[1];
  }
  return null;
}

export const extractVideoId = extractYoutubeVideoId;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMetadata(raw: any): YtVideoMetadata {
  const id = String(raw?.id || raw?.videoId || '');
  const duration = Number(raw?.duration || raw?.lengthSeconds || 0);
  const title = clean(raw?.title || raw?.fulltitle || '');
  const description = clean(raw?.description || raw?.shortDescription || '').slice(0, 2000);
  const rawUrlCandidates = `${raw?.url || ''} ${raw?.webpage_url || ''} ${raw?.original_url || ''}`;
  const isShortUrl = /\/shorts\//i.test(rawUrlCandidates);
  const hasShortTag = /(^|[\s#])#shorts?\b/i.test(`${title} ${description.slice(0, 300)}`);
  const width = Number(raw?.width || 0);
  const height = Number(raw?.height || 0);
  const aspect = Number(raw?.aspect_ratio || (width && height ? width / height : 0));
  const thumbs = Array.isArray(raw?.thumbnails)
    ? raw.thumbnails
    : Array.isArray(raw?.thumbnail?.thumbnails)
      ? raw.thumbnail.thumbnails
      : [];
  const isVerticalThumb =
    thumbs.length > 0 &&
    thumbs.every((t: { width?: number; height?: number }) => Number(t?.height) > Number(t?.width));
  const isShort = Boolean(
    isShortUrl ||
      hasShortTag ||
      (aspect > 0 && aspect < 1) ||
      isVerticalThumb ||
      (duration > 0 && duration <= 60 && isShortUrl),
  );

  const canonicalUrl = id
    ? isShortUrl
      ? `https://www.youtube.com/shorts/${id}`
      : `https://www.youtube.com/watch?v=${id}`
    : clean(raw?.webpage_url || raw?.original_url || raw?.url || '');

  return {
    id,
    title,
    url: canonicalUrl,
    channel: clean(raw?.uploader || raw?.channel || raw?.author || ''),
    channelUrl: clean(raw?.uploader_url || raw?.channel_url || ''),
    duration,
    durationString: duration > 0 ? formatDuration(duration) : clean(raw?.duration_string) || '0:00',
    viewCount: Number(raw?.view_count || raw?.viewCount || 0),
    likeCount: raw?.like_count ? Number(raw.like_count) : undefined,
    uploadDate: clean(raw?.upload_date || ''),
    thumbnail: clean(
      raw?.thumbnail && typeof raw.thumbnail === 'string'
        ? raw.thumbnail
        : (thumbs[thumbs.length - 1]?.url || thumbs[0]?.url || ''),
    ),
    description,
    isShort,
    categories: Array.isArray(raw?.categories) ? raw.categories : undefined,
    tags: Array.isArray(raw?.tags) ? raw.tags.slice(0, 20) : undefined,
  };
}

// ── Multi-Format Subtitle Parser (VTT / SRT / JSON3 / XML / SRV3) ───────────
function parseTimestampToSec(ts: string): number {
  const parts = ts.trim().replace(',', '.').split(':');
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }
  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number(parts[1]);
  }
  return 0;
}

function appendDedupedSegment(
  segments: TranscriptSegment[],
  startSec: number,
  endSec: number,
  rawText: string,
): void {
  const cleanedText = decodeEntities(
    rawText
      .replace(/<[^>]+>/g, '') // Strip <c>, <00:00:01.200> VTT word timestamps
      .replace(/\{[^}]+\}/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanedText || /^\[(music|applause|laughter)\]$/i.test(cleanedText)) return;
  const prev = segments[segments.length - 1];
  if (!prev || prev.text !== cleanedText) {
    if (prev && cleanedText.startsWith(prev.text)) {
      const delta = cleanedText.slice(prev.text.length).trim();
      if (delta) {
        segments.push({
          startSec: Math.round(startSec * 10) / 10,
          endSec: Math.round(endSec * 10) / 10,
          timestamp: formatDuration(startSec),
          text: delta,
        });
      }
    } else {
      segments.push({
        startSec: Math.round(startSec * 10) / 10,
        endSec: Math.round(endSec * 10) / 10,
        timestamp: formatDuration(startSec),
        text: cleanedText,
      });
    }
  }
}

export function parseVttOrSrt(content: string): TranscriptSegment[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // 1. Handle YouTube JSON3 format (`{"wireMagic":"pb3","events":[...]}`)
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
      if (Array.isArray(data?.events)) {
        const segments: TranscriptSegment[] = [];
        for (const ev of data.events) {
          if (!Array.isArray(ev?.segs)) continue;
          const text = ev.segs.map((s: { utf8?: string }) => s?.utf8 || '').join('');
          const startSec = Number(ev.tStartMs || 0) / 1000;
          const endSec = startSec + Number(ev.dDurationMs || 2000) / 1000;
          appendDedupedSegment(segments, startSec, endSec, text);
        }
        if (segments.length) return segments;
      }
    } catch {
      /* fall through */
    }
  }

  // 2. Handle YouTube XML / SRV1 / SRV3 format (`<text start="1.2" dur="3.4">...</text>` or `<p t="1200" d="3400">...</p>`)
  if (trimmed.startsWith('<') && (trimmed.includes('<text') || trimmed.includes('<p '))) {
    const segments: TranscriptSegment[] = [];
    const textRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = textRe.exec(trimmed))) {
      const attrs = m[1];
      const startMatch = /\bstart=["']([0-9.]+)["']/i.exec(attrs);
      const durMatch = /\bdur=["']([0-9.]+)["']/i.exec(attrs);
      const startSec = startMatch ? Number(startMatch[1]) : 0;
      const durSec = durMatch ? Number(durMatch[1]) : 2;
      appendDedupedSegment(segments, startSec, startSec + durSec, m[2]);
    }
    if (segments.length) return segments;

    const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    // eslint-disable-next-line no-cond-assign
    while ((m = pRe.exec(trimmed))) {
      const attrs = m[1];
      const tMatch = /\bt=["']([0-9.]+)["']/i.exec(attrs);
      const dMatch = /\bd=["']([0-9.]+)["']/i.exec(attrs);
      const startSec = tMatch ? Number(tMatch[1]) / 1000 : 0;
      const durSec = dMatch ? Number(dMatch[1]) / 1000 : 2;
      appendDedupedSegment(segments, startSec, startSec + durSec, m[2]);
    }
    if (segments.length) return segments;
  }

  // 3. Standard WEBVTT / SRT format
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const segments: TranscriptSegment[] = [];
  const timeRe =
    /((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})/;

  let currentStart = 0;
  let currentEnd = 0;
  let inCue = false;
  let cueLines: string[] = [];

  const flushCue = () => {
    if (!inCue || !cueLines.length) return;
    appendDedupedSegment(segments, currentStart, currentEnd, cueLines.join(' '));
    cueLines = [];
    inCue = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (
      !line ||
      line === 'WEBVTT' ||
      line.startsWith('Kind:') ||
      line.startsWith('Language:') ||
      line.startsWith('NOTE') ||
      /^\d+$/.test(line)
    ) {
      if (!line) flushCue();
      continue;
    }
    const m = timeRe.exec(line);
    if (m) {
      flushCue();
      currentStart = parseTimestampToSec(m[1]);
      currentEnd = parseTimestampToSec(m[2]);
      inCue = true;
      continue;
    }
    if (inCue) {
      cueLines.push(line);
    }
  }
  flushCue();
  return segments;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function selectSingleSubUrlFromYtDlpJson(parsed: any, preferredLang: string): { url: string; lang: string; ext: string } | null {
  const subsObj = parsed?.subtitles || {};
  const autoObj = parsed?.automatic_captions || {};
  const langLower = preferredLang.toLowerCase();

  const pickFromMap = (
    map: Record<string, Array<{ ext?: string; url?: string }>>,
  ): { url: string; lang: string; ext: string } | null => {
    const keys = Object.keys(map);
    if (!keys.length) return null;
    const orderedKeys = [
      ...keys.filter((k) => k.toLowerCase() === langLower),
      ...keys.filter((k) => k.toLowerCase() === `${langLower}-orig`),
      ...keys.filter((k) => k.toLowerCase().startsWith(`${langLower}-`)),
      ...keys.filter((k) => k.toLowerCase() === 'en'),
      ...keys.filter((k) => k.toLowerCase().startsWith('en-')),
      ...keys,
    ];
    const seen = new Set<string>();
    for (const k of orderedKeys) {
      if (seen.has(k)) continue;
      seen.add(k);
      const formats = map[k];
      if (!Array.isArray(formats) || !formats.length) continue;
      for (const ext of ['vtt', 'json3', 'srv1', 'srv3', 'ttml']) {
        const hit = formats.find((f) => f?.ext === ext && f?.url);
        if (hit?.url) return { url: hit.url, lang: k, ext };
      }
      if (formats[0]?.url) {
        return { url: formats[0].url, lang: k, ext: formats[0].ext || 'vtt' };
      }
    }
    return null;
  };

  return pickFromMap(subsObj) || pickFromMap(autoObj);
}

// Fast native Innertube / Watch-page transcript extractor (~1s when YouTube allows direct caption fetch)
async function tryFastInnertubeTranscript(
  videoId: string,
  preferredLang: string,
  deadline: number,
): Promise<{ metadata?: YtVideoMetadata; segments: TranscriptSegment[]; language: string } | null> {
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`;
    const { status, text } = await fetchTextWithJar(
      'yt-watch',
      watchUrl,
      Math.min(deadline, Date.now() + 4_500),
      {
        'User-Agent': DEFAULT_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+410',
      },
    );
    if (status >= 400 || !text) return null;

    const marker = 'ytInitialPlayerResponse = ';
    const idx = text.indexOf(marker);
    if (idx === -1) return null;
    const jsonStart = text.indexOf('{', idx);
    if (jsonStart === -1) return null;

    let depth = 0;
    let inStr = false;
    let esc = false;
    let jsonEnd = -1;
    for (let i = jsonStart; i < Math.min(text.length, jsonStart + 600_000); i++) {
      const ch = text[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\' && inStr) {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (!inStr) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            jsonEnd = i + 1;
            break;
          }
        }
      }
    }
    if (jsonEnd === -1) return null;

    const playerResp = JSON.parse(text.slice(jsonStart, jsonEnd));
    const metadata = playerResp?.videoDetails ? mapMetadata(playerResp.videoDetails) : undefined;
    const tracks: Array<{ baseUrl?: string; languageCode?: string; kind?: string }> =
      playerResp?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!tracks.length) return null;

    const langLower = preferredLang.toLowerCase();
    const chosen =
      tracks.find((t) => t.languageCode?.toLowerCase() === langLower && t.kind !== 'asr') ||
      tracks.find((t) => t.languageCode?.toLowerCase().startsWith(`${langLower}-`) && t.kind !== 'asr') ||
      tracks.find((t) => t.languageCode?.toLowerCase() === langLower) ||
      tracks.find((t) => t.languageCode?.toLowerCase().startsWith(`${langLower}-`)) ||
      tracks.find((t) => t.languageCode?.toLowerCase().startsWith('en')) ||
      tracks[0];

    if (!chosen?.baseUrl || chosen.baseUrl.includes('exp=xpe')) return null;

    for (const fmt of ['vtt', 'json3', '']) {
      const subUrl = fmt ? `${chosen.baseUrl}&fmt=${fmt}` : chosen.baseUrl;
      const subRes = await fetchTextWithJar(
        'yt-watch',
        subUrl,
        Math.min(deadline, Date.now() + 3_500),
        {
          'User-Agent': DEFAULT_UA,
          Referer: watchUrl,
        },
      );
      if (subRes.status === 200 && subRes.text.trim().length > 20) {
        const segments = parseVttOrSrt(subRes.text);
        if (segments.length > 0) {
          return {
            metadata,
            segments,
            language: chosen.languageCode || preferredLang,
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Main YouTube Tool Entrypoint ────────────────────────────────────────────
function parseDurationStrToSeconds(str: string): number {
  const s = clean(str);
  if (!s) return 0;
  if (/^shorts?$/i.test(s)) return 45;
  const parts = s.split(':').map((p) => Number(p.replace(/[^\d]/g, '')));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

function parseViewsText(str: string): number {
  const s = clean(str).toUpperCase();
  if (!s) return 0;
  const m = /([\d,.]+)\s*([KMB])?/.exec(s);
  if (!m) return 0;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(num)) return 0;
  const mult = m[2] === 'B' ? 1_000_000_000 : m[2] === 'M' ? 1_000_000 : m[2] === 'K' ? 1_000 : 1;
  return Math.round(num * mult);
}

async function tryDirectYoutubeSearch(
  query: string,
  videoType: YtVideoType,
  limit: number,
  timeoutMs = 10_000,
): Promise<YtVideoMetadata[]> {
  try {
    const cleanQ = query.replace(/^ytsearch\d*:/i, '').trim();
    // sp=EgIYAQ%3D%3D is YouTube's native Shorts / <4m filter tab
    const spParam = videoType === 'shorts' ? '&sp=EgIYAQ%3D%3D' : '';
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQ)}${spParam}`;
    const { status, text } = await fetchTextWithJar(
      'yt-search',
      searchUrl,
      Date.now() + timeoutMs,
      {
        'User-Agent': DEFAULT_UA,
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'CONSENT=YES+cb.20210328-17-p0.en+FX+410',
      },
    );
    if (status >= 400 || !text) return [];
    const m = /var ytInitialData\s*=\s*(\{[\s\S]*?\});<\/script>/.exec(text);
    if (!m) return [];
    const data = JSON.parse(m[1]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const videoRenderers: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shortsModels: any[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (node: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.videoRenderer) videoRenderers.push(node.videoRenderer);
      if (node.shortsLockupViewModel) shortsModels.push(node.shortsLockupViewModel);
      for (const v of Object.values(node)) {
        if (v && typeof v === 'object') walk(v);
      }
    };
    walk(data);

    const parsedVideos: YtVideoMetadata[] = [];
    const seenIds = new Set<string>();

    // 1. Parse standard videoRenderers
    for (const vr of videoRenderers) {
      const id = clean(vr?.videoId);
      if (!id || seenIds.has(id)) continue;
      const title = clean(
        vr?.title?.runs?.map((r: { text?: string }) => r.text || '').join('') ||
          vr?.title?.simpleText ||
          '',
      );
      if (!title) continue;
      const navUrl = clean(vr?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '');
      const overlayStyle = clean(
        vr?.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.style || '',
      );
      const lenStr = clean(
        vr?.lengthText?.simpleText ||
          vr?.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText ||
          '',
      );
      const duration = parseDurationStrToSeconds(lenStr);
      // Skip live streams with no duration when searching normal videos unless needed
      if (!lenStr && overlayStyle === 'LIVE') continue;

      const isShort = Boolean(
        overlayStyle === 'SHORTS' ||
          navUrl.startsWith('/shorts/') ||
          /(^|[\s#])#shorts?\b/i.test(title) ||
          (duration > 0 && duration <= 60),
      );

      seenIds.add(id);
      const channel = clean(
        vr?.ownerText?.runs?.[0]?.text || vr?.longBylineText?.runs?.[0]?.text || '',
      );
      const channelPath = clean(
        vr?.ownerText?.runs?.[0]?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url ||
          '',
      );
      const viewText = clean(
        vr?.viewCountText?.simpleText || vr?.shortViewCountText?.simpleText || '',
      );
      const uploadDate = clean(vr?.publishedTimeText?.simpleText || '');
      const thumbs = Array.isArray(vr?.thumbnail?.thumbnails) ? vr.thumbnail.thumbnails : [];
      const thumbnail = clean(thumbs[thumbs.length - 1]?.url || '');
      const descSnippet = clean(
        vr?.detailedMetadataSnippets?.[0]?.snippetText?.runs
          ?.map((r: { text?: string }) => r.text || '')
          .join('') || '',
      );

      parsedVideos.push({
        id,
        title,
        url: isShort
          ? `https://www.youtube.com/shorts/${id}`
          : `https://www.youtube.com/watch?v=${id}`,
        channel,
        channelUrl: channelPath ? `https://www.youtube.com${channelPath}` : '',
        duration,
        durationString: duration > 0 ? formatDuration(duration) : lenStr || '0:00',
        viewCount: parseViewsText(viewText),
        uploadDate,
        thumbnail,
        description: descSnippet,
        isShort,
      });
    }

    // 2. Parse shortsLockupViewModel items
    const parsedShorts: YtVideoMetadata[] = [];
    for (const sm of shortsModels) {
      const id = clean(
        sm?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ||
          (sm?.entityId || '').replace(/^shorts-shelf-item-/, ''),
      );
      if (!id || seenIds.has(id)) continue;
      const title = clean(
        sm?.overlayMetadata?.primaryText?.content ||
          (sm?.accessibilityText || '').split(/,\s*\d/)[0] ||
          '',
      );
      if (!title) continue;
      seenIds.add(id);
      const viewText = clean(sm?.overlayMetadata?.secondaryText?.content || '');
      const thumb = clean(
        sm?.thumbnailViewModel?.thumbnailViewModel?.image?.sources?.[0]?.url ||
          sm?.onTap?.innertubeCommand?.reelWatchEndpoint?.thumbnail?.thumbnails?.[0]?.url ||
          `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      );
      parsedShorts.push({
        id,
        title,
        url: `https://www.youtube.com/shorts/${id}`,
        channel: 'YouTube Shorts',
        channelUrl: '',
        duration: 45,
        durationString: 'Short (<=60s)',
        viewCount: parseViewsText(viewText),
        uploadDate: '',
        thumbnail: thumb,
        description: title,
        isShort: true,
      });
    }

    if (videoType === 'shorts') {
      const onlyShorts = [...parsedShorts, ...parsedVideos.filter((v) => v.isShort)];
      return onlyShorts.slice(0, limit);
    }
    if (videoType === 'long') {
      const onlyLong = parsedVideos.filter((v) => !v.isShort && v.duration > 60);
      return (onlyLong.length > 0 ? onlyLong : parsedVideos.filter((v) => !v.isShort)).slice(
        0,
        limit,
      );
    }
    // videoType === 'all'
    return [...parsedVideos, ...parsedShorts].slice(0, limit);
  } catch {
    return [];
  }
}

export async function youtubeTool(options: YtToolOptions): Promise<YtToolResult> {
  const started = Date.now();
  const rawInput = clean(options.input);
  if (!rawInput) {
    throw new Error('youtubeTool requires a non-empty "input" (URL, video ID, or search query).');
  }

  const directVideoId = extractYoutubeVideoId(rawInput);
  // If no explicit mode was provided and input is a plain search phrase (not a URL or 11-char ID), default to 'search'
  const mode: YtMode =
    options.mode || (isHttpUrl(rawInput) || directVideoId ? 'video' : 'search');
  const videoType: YtVideoType = options.videoType || 'long';

  const ytDlpBin = await ensureYtDlp();
  const ffmpegBin = findFfmpegBinary();
  const ffmpegOk = Boolean(ffmpegBin);
  const baseArgs = ['--no-warnings', '--no-check-certificates', '--geo-bypass'];
  if (ffmpegBin) {
    baseArgs.push('--ffmpeg-location', ffmpegBin);
  }
  if (options.cookiesFile && fsSync.existsSync(options.cookiesFile)) {
    baseArgs.push('--cookies', path.resolve(options.cookiesFile));
  }

  // ── Mode 1: YouTube Search (with Shorts vs Long-Form Filtering) ───────────
  if (mode === 'search') {
    const limit = Math.max(1, Math.min(25, Math.floor(Number(options.searchLimit) || 5)));
    const timeoutMs = options.timeoutMs ?? 30_000;

    // Tier 1: Fast direct YouTube ytInitialData search (~800ms) with native Long vs Shorts separation
    const fastItems = await tryDirectYoutubeSearch(
      rawInput,
      videoType,
      limit,
      Math.min(10_000, timeoutMs),
    );
    if (fastItems.length > 0) {
      return {
        mode,
        input: rawInput,
        ok: true,
        searchResults: fastItems,
        metadata: fastItems[0],
        ytDlpBinary: ytDlpBin,
        ffmpegAvailable: ffmpegOk,
        ms: Date.now() - started,
      };
    }

    // Tier 2: Fallback to yt-dlp `ytsearch`
    const fetchCount =
      videoType === 'all' ? limit : Math.min(40, Math.max(limit * 4, 15));
    const target = rawInput.startsWith('ytsearch')
      ? rawInput
      : `ytsearch${fetchCount}:${rawInput}`;
    const { code, stdout, stderr } = await runProcess(
      ytDlpBin,
      [...baseArgs, '--dump-json', '--flat-playlist', '--no-playlist', target],
      timeoutMs,
    );
    if (code !== 0 && !stdout.trim()) {
      return {
        mode,
        input: rawInput,
        ok: false,
        ytDlpBinary: ytDlpBin,
        ffmpegAvailable: ffmpegOk,
        ms: Date.now() - started,
        error: clean(stderr) || `yt-dlp exited with code ${code}`,
      };
    }
    const allItems: YtVideoMetadata[] = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        allItems.push(mapMetadata(JSON.parse(trimmed)));
      } catch {
        /* ignore non-JSON lines */
      }
    }

    let filtered: YtVideoMetadata[] = allItems;
    if (videoType === 'long') {
      // Strictly exclude Shorts and <= 60s vertical/short clips by default
      const longOnly = allItems.filter(
        (item) => !item.isShort && (item.duration === 0 || item.duration > 60),
      );
      if (longOnly.length > 0) {
        filtered = longOnly;
      } else {
        filtered = allItems.filter((item) => !item.isShort);
      }
    } else if (videoType === 'shorts') {
      filtered = allItems
        .filter((item) => item.isShort || (item.duration > 0 && item.duration <= 90))
        .map((item) => ({
          ...item,
          isShort: true,
          url: item.id ? `https://www.youtube.com/shorts/${item.id}` : item.url,
        }));
    }

    const items = filtered.slice(0, limit);
    return {
      mode,
      input: rawInput,
      ok: items.length > 0,
      searchResults: items,
      metadata: items[0],
      ytDlpBinary: ytDlpBin,
      ffmpegAvailable: ffmpegOk,
      ms: Date.now() - started,
      error: items.length === 0 ? `No matching YouTube ${videoType} videos found for "${rawInput}"` : undefined,
    };
  }

  // Normalize input: if user passed a bare 11-char ID or search query for video/audio/info/transcript
  const targetInput = isHttpUrl(rawInput)
    ? rawInput
    : directVideoId
      ? `https://www.youtube.com/watch?v=${directVideoId}`
      : rawInput.startsWith('ytsearch')
        ? rawInput
        : `ytsearch1:${rawInput}`;

  // ── Mode 2: Metadata / Info Probe ─────────────────────────────────────────
  if (mode === 'info') {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const { code, stdout, stderr } = await runProcess(
      ytDlpBin,
      [...baseArgs, '--dump-single-json', '--no-playlist', targetInput],
      timeoutMs,
    );
    if (code !== 0 && !stdout.trim()) {
      return {
        mode,
        input: rawInput,
        ok: false,
        ytDlpBinary: ytDlpBin,
        ffmpegAvailable: ffmpegOk,
        ms: Date.now() - started,
        error: clean(stderr) || `yt-dlp exited with code ${code}`,
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any = JSON.parse(stdout.trim().split('\n').pop() || '{}');
    if (Array.isArray(parsed?.entries) && parsed.entries.length) {
      parsed = parsed.entries[0];
    }
    return {
      mode,
      input: rawInput,
      ok: true,
      metadata: mapMetadata(parsed),
      ytDlpBinary: ytDlpBin,
      ffmpegAvailable: ffmpegOk,
      ms: Date.now() - started,
    };
  }

  // ── Mode 3: Transcript / Subtitle Extraction (Fast Direct + Single-Track JSON) ─
  if (mode === 'transcript') {
    const timeoutMs = options.timeoutMs ?? 35_000;
    const deadline = started + timeoutMs;
    const lang = clean(options.subLang || 'en');

    // Tier 1: Try fast direct Innertube/watch-page extraction (~1s) when videoId is known
    if (directVideoId) {
      const fastHit = await tryFastInnertubeTranscript(directVideoId, lang, deadline);
      if (fastHit && fastHit.segments.length > 0) {
        const fullText = fastHit.segments.map((s) => s.text).join(' ');
        const mdLines = [
          `# Transcript: ${fastHit.metadata?.title || rawInput}`,
          fastHit.metadata?.channel
            ? `**Channel:** ${fastHit.metadata.channel} | **Duration:** ${fastHit.metadata.durationString}`
            : '',
          fastHit.metadata?.url ? `**URL:** ${fastHit.metadata.url}` : '',
          '',
          ...fastHit.segments.map((s) => `- **[${s.timestamp}]** ${s.text}`),
        ].filter(Boolean);

        return {
          mode,
          input: rawInput,
          ok: true,
          metadata: fastHit.metadata,
          transcript: {
            language: fastHit.language,
            fullText,
            markdown: mdLines.join('\n'),
            segments: fastHit.segments,
          },
          ytDlpBinary: ytDlpBin,
          ffmpegAvailable: ffmpegOk,
          ms: Date.now() - started,
        };
      }
    }

    // Tier 2: Use `yt-dlp --dump-single-json --skip-download` and fetch only ONE subtitle track URL
    // (Prevents yt-dlp from downloading 10+ regional/auto subtitle files and hitting HTTP 429 rate limits!)
    const { code, stdout, stderr } = await runProcess(
      ytDlpBin,
      [...baseArgs, '--dump-single-json', '--no-playlist', '--skip-download', targetInput],
      Math.max(10_000, deadline - Date.now()),
    );

    if (code !== 0 && !stdout.trim()) {
      return {
        mode,
        input: rawInput,
        ok: false,
        ytDlpBinary: ytDlpBin,
        ffmpegAvailable: ffmpegOk,
        ms: Date.now() - started,
        error: clean(stderr) || `yt-dlp exited with code ${code}`,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any = {};
    try {
      parsed = JSON.parse(stdout.trim().split('\n').pop() || '{}');
      if (Array.isArray(parsed?.entries) && parsed.entries.length) {
        parsed = parsed.entries[0];
      }
    } catch {
      return {
        mode,
        input: rawInput,
        ok: false,
        ytDlpBinary: ytDlpBin,
        ffmpegAvailable: ffmpegOk,
        ms: Date.now() - started,
        error: 'Failed to parse yt-dlp video metadata JSON.',
      };
    }

    const metadata = mapMetadata(parsed);
    const chosenSub = selectSingleSubUrlFromYtDlpJson(parsed, lang);
    if (!chosenSub) {
      return {
        mode,
        input: rawInput,
        ok: false,
        metadata,
        ytDlpBinary: ytDlpBin,
        ffmpegAvailable: ffmpegOk,
        ms: Date.now() - started,
        error: 'No subtitles or auto-captions found for this video.',
      };
    }

    let subText = '';
    let subStatus = 0;
    try {
      const subRes = await fetchTextWithJar(
        'yt-subs-single',
        chosenSub.url,
        Math.max(Date.now() + 10_000, deadline),
        {
          'User-Agent': DEFAULT_UA,
          'Accept-Language': 'en-US,en;q=0.9',
        },
      );
      subText = subRes.text;
      subStatus = subRes.status;
    } catch (subErr) {
      return {
        mode,
        input: rawInput,
        ok: false,
        metadata,
        ytDlpBinary: ytDlpBin,
        ffmpegAvailable: ffmpegOk,
        ms: Date.now() - started,
        error: `Failed to fetch subtitle track (${chosenSub.lang}): ${(subErr as Error)?.message || String(subErr)}`,
      };
    }

    const segments = parseVttOrSrt(subText);
    if (!segments.length) {
      return {
        mode,
        input: rawInput,
        ok: false,
        metadata,
        ytDlpBinary: ytDlpBin,
        ffmpegAvailable: ffmpegOk,
        ms: Date.now() - started,
        error: `Subtitle track (${chosenSub.lang}) was empty or could not be parsed (HTTP ${subStatus}).`,
      };
    }

    const fullText = segments.map((s) => s.text).join(' ');
    const mdLines = [
      `# Transcript: ${metadata?.title || rawInput}`,
      metadata?.channel
        ? `**Channel:** ${metadata.channel} | **Duration:** ${metadata.durationString}`
        : '',
      metadata?.url ? `**URL:** ${metadata.url}` : '',
      '',
      ...segments.map((s) => `- **[${s.timestamp}]** ${s.text}`),
    ].filter(Boolean);

    return {
      mode,
      input: rawInput,
      ok: true,
      metadata,
      transcript: {
        language: chosenSub.lang,
        fullText,
        markdown: mdLines.join('\n'),
        segments,
      },
      ytDlpBinary: ytDlpBin,
      ffmpegAvailable: ffmpegOk,
      ms: Date.now() - started,
    };
  }

  // ── Mode 4 & 5: Audio (Music) or Video Download ───────────────────────────
  const outputDir = path.resolve(options.outputDir || path.join(process.cwd(), 'downloads'));
  await fs.mkdir(outputDir, { recursive: true });
  const timeoutMs = options.timeoutMs ?? 240_000;
  const prefix = options.filenamePrefix ? `${options.filenamePrefix}-` : '';
  const outTemplate = path.join(outputDir, `${prefix}%(title).80B [%(id)s].%(ext)s`);

  const dlArgs = [
    ...baseArgs,
    '--no-playlist',
    '--restrict-filenames',
    '--write-info-json',
    '--print',
    'after_move:filepath',
    '-o',
    outTemplate,
  ];

  if (mode === 'audio') {
    const audioFormat = options.audioFormat || (ffmpegOk ? 'mp3' : 'm4a');
    if (ffmpegOk) {
      dlArgs.push('-x', '--audio-format', audioFormat === 'best' ? 'best' : audioFormat, '--audio-quality', '0');
      if (options.embedMetadata !== false) {
        dlArgs.push('--embed-metadata');
      }
    } else {
      // Without ffmpeg, download best standalone audio stream (usually m4a/webm)
      dlArgs.push('-f', 'ba[ext=m4a]/ba/b');
    }
  } else {
    // Video mode
    const maxH = options.maxHeight || 1080;
    const vFormat = options.videoFormat || 'mp4';
    if (ffmpegOk) {
      dlArgs.push(
        '-f',
        `bv*[height<=${maxH}][ext=mp4]+ba[ext=m4a]/bv*[height<=${maxH}]+ba/b[height<=${maxH}]/b`,
        '--merge-output-format',
        vFormat,
      );
    } else {
      // Single pre-merged file fallback when ffmpeg is not installed
      dlArgs.push('-f', `b[height<=${maxH}][ext=mp4]/b[height<=${maxH}]/b`);
    }
  }

  dlArgs.push(targetInput);
  const { code, stdout, stderr } = await runProcess(ytDlpBin, dlArgs, timeoutMs);

  const printedLines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  let finalFilePath = printedLines[printedLines.length - 1] || '';

  if (!finalFilePath || !fsSync.existsSync(finalFilePath)) {
    // Fallback: locate newest non-json file in outputDir
    const files = await fs.readdir(outputDir);
    const mediaFiles = files.filter((f) => !f.endsWith('.json') && !f.endsWith('.part'));
    if (mediaFiles.length) {
      const withStats = await Promise.all(
        mediaFiles.map(async (f) => ({
          f: path.join(outputDir, f),
          mtime: (await fs.stat(path.join(outputDir, f))).mtimeMs,
        })),
      );
      withStats.sort((a, b) => b.mtime - a.mtime);
      if (withStats[0] && withStats[0].mtime >= started - 2000) {
        finalFilePath = withStats[0].f;
      }
    }
  }

  if (code !== 0 && (!finalFilePath || !fsSync.existsSync(finalFilePath))) {
    return {
      mode,
      input: rawInput,
      ok: false,
      ytDlpBinary: ytDlpBin,
      ffmpegAvailable: ffmpegOk,
      ms: Date.now() - started,
      error: clean(stderr) || `yt-dlp download failed with code ${code}`,
    };
  }

  // Read companion .info.json if written, then clean it up
  let metadata: YtVideoMetadata | undefined;
  try {
    const dirFiles = await fs.readdir(outputDir);
    const infoFiles = dirFiles.filter((f) => f.endsWith('.info.json'));
    for (const inf of infoFiles) {
      const infPath = path.join(outputDir, inf);
      const st = await fs.stat(infPath);
      if (st.mtimeMs >= started - 2000) {
        const raw = JSON.parse(await fs.readFile(infPath, 'utf8'));
        if (!Array.isArray(raw?.entries)) {
          metadata = mapMetadata(raw);
        }
        await fs.unlink(infPath).catch(() => {});
      }
    }
  } catch {
    /* ignore */
  }

  const stat = await fs.stat(finalFilePath);
  return {
    mode,
    input: rawInput,
    ok: true,
    filePath: finalFilePath,
    fileName: path.basename(finalFilePath),
    bytes: stat.size,
    metadata,
    ytDlpBinary: ytDlpBin,
    ffmpegAvailable: ffmpegOk,
    ms: Date.now() - started,
  };
}
