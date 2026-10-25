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
export declare function findFfmpegBinary(): string | null;
export declare function hasFfmpeg(): boolean;
export declare function ensureYtDlp(): Promise<string>;
export declare function extractYoutubeVideoId(input: string): string | null;
export declare const extractVideoId: typeof extractYoutubeVideoId;
export declare function parseVttOrSrt(content: string): TranscriptSegment[];
export declare function youtubeTool(options: YtToolOptions): Promise<YtToolResult>;
//# sourceMappingURL=yt-downloader.d.ts.map