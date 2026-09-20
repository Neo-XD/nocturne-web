import type {
	BrowseItem,
	HomePage,
	NowPlaying,
	QueueState,
	RepeatMode,
	SongItem,
	UnlistenFn
} from './api';
import {
	ytmSearchSongs,
	ytmSearchAll,
	ytmGetHome,
	ytmGetAlbum,
	ytmGetArtist,
	ytmGetPlaylist,
	ytmGetAccount,
	setStoredCookie
} from './ytmusic';
import { openLoginModal } from './loginModal.svelte';

// Invidious instances with CORS and active API support
const INVIDIOUS_INSTANCES = [
	'https://invidious.f5.si',
	'https://inv.vern.cc',
	'https://invidious.nerdvpn.de',
	'https://vid.priv.au'
];

let currentInstanceIndex = 0;
function getInstance(): string {
	return INVIDIOUS_INSTANCES[currentInstanceIndex % INVIDIOUS_INSTANCES.length];
}
function rotateInstance(): void {
	currentInstanceIndex = (currentInstanceIndex + 1) % INVIDIOUS_INSTANCES.length;
}

// ---------------------------------------------------------------------------
// Web Event Bus (replaces Tauri event system)
// ---------------------------------------------------------------------------
const listeners = new Map<string, Set<(e: { payload: any }) => void>>();

export function registerWebListener<T>(
	event: string,
	handler: (e: { payload: T }) => void
): Promise<UnlistenFn> {
	if (!listeners.has(event)) {
		listeners.set(event, new Set());
	}
	const set = listeners.get(event)!;
	set.add(handler as any);
	return Promise.resolve(() => {
		set.delete(handler as any);
	});
}

export function emitWebEvent(event: string, payload: any): void {
	const set = listeners.get(event);
	if (set) {
		for (const fn of set) {
			try {
				fn({ payload });
			} catch (e) {
				console.error(`Error in web event handler for ${event}:`, e);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// HTML5 Web Audio Playback Engine
// ---------------------------------------------------------------------------
class WebAudioEngine {
	private audio: HTMLAudioElement | null = null;
	public queue: QueueState = {
		items: [],
		currentIndex: 0,
		shuffle: false,
		repeat: 'off',
		sourceName: null
	};
	public now: NowPlaying | null = null;
	public paused = true;
	public position = 0;
	public duration = 0;
	public volume = 80;
	private abortController: AbortController | null = null;

	constructor() {
		if (typeof window !== 'undefined') {
			this.audio = new Audio();
			this.audio.preload = 'auto';
			this.audio.volume = this.volume / 100;

			this.audio.addEventListener('timeupdate', () => {
				if (!this.audio) return;
				this.position = this.audio.currentTime;
				emitWebEvent('position', this.position);
			});

			this.audio.addEventListener('durationchange', () => {
				if (!this.audio || !Number.isFinite(this.audio.duration)) return;
				this.duration = this.audio.duration;
				emitWebEvent('duration', this.duration);
			});

			this.audio.addEventListener('play', () => {
				this.paused = false;
				emitWebEvent('playback-state', 'playing');
			});

			this.audio.addEventListener('pause', () => {
				this.paused = true;
				emitWebEvent('playback-state', 'paused');
			});

			this.audio.addEventListener('ended', () => {
				this.handleTrackEnded();
			});

			this.audio.addEventListener('error', (e) => {
				console.warn('Audio playback error:', e);
				emitWebEvent('playback-error', 'Playback stream error. Skipping to next track...');
				setTimeout(() => this.nextTrack(), 1500);
			});

			this.setupMediaSession();
		}
	}

	private setupMediaSession() {
		if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
			navigator.mediaSession.setActionHandler('play', () => this.resume());
			navigator.mediaSession.setActionHandler('pause', () => this.pause());
			navigator.mediaSession.setActionHandler('previoustrack', () => this.prevTrack());
			navigator.mediaSession.setActionHandler('nexttrack', () => this.nextTrack());
			navigator.mediaSession.setActionHandler('seekto', (details) => {
				if (details.seekTime !== undefined) this.seek(details.seekTime);
			});
		}
	}

	private updateMediaSessionMetadata(item: SongItem) {
		if (typeof navigator !== 'undefined' && 'mediaSession' in navigator && window.MediaMetadata) {
			navigator.mediaSession.metadata = new window.MediaMetadata({
				title: item.title,
				artist: item.artists,
				album: item.album || 'Nocturne Web',
				artwork: item.thumbnail
					? [
							{ src: item.thumbnail, sizes: '96x96', type: 'image/jpeg' },
							{ src: item.thumbnail, sizes: '128x128', type: 'image/jpeg' },
							{ src: item.thumbnail, sizes: '256x256', type: 'image/jpeg' },
							{ src: item.thumbnail, sizes: '512x512', type: 'image/jpeg' }
						]
					: []
			});
		}
	}

	public async play(item: SongItem): Promise<void> {
		if (!this.audio) return;

		// If item is already in queue, set currentIndex to it
		const existingIndex = this.queue.items.findIndex((i) => i.video_id === item.video_id);
		if (existingIndex !== -1) {
			this.queue.currentIndex = existingIndex;
		} else {
			this.queue.items = [item, ...this.queue.items];
			this.queue.currentIndex = 0;
		}

		emitWebEvent('queue-changed', this.queue);
		await this.loadAndStreamTrack(item);
	}

	public async playIndex(index: number): Promise<void> {
		if (index < 0 || index >= this.queue.items.length) return;
		this.queue.currentIndex = index;
		emitWebEvent('queue-index', {
			currentIndex: index,
			current: this.queue.items[index],
			playedFrom: 0,
			shuffle: this.queue.shuffle,
			repeat: this.queue.repeat,
			sourceName: this.queue.sourceName
		});
		await this.loadAndStreamTrack(this.queue.items[index]);
	}

	public async playPlaylist(
		items: SongItem[],
		startIndex: number | null = 0,
		sourceId?: string,
		sourceTitle?: string,
		shuffle = false
	): Promise<void> {
		if (!items.length) return;
		this.queue.items = [...items];
		this.queue.currentIndex = startIndex ?? 0;
		this.queue.shuffle = shuffle;
		this.queue.sourceName = sourceTitle ?? null;
		emitWebEvent('queue-changed', this.queue);

		const track = this.queue.items[this.queue.currentIndex];
		if (track) {
			await this.loadAndStreamTrack(track);
		}
	}

	private async loadAndStreamTrack(item: SongItem): Promise<void> {
		if (!this.audio) return;

		// Cancel any previous in-flight stream fetch
		if (this.abortController) {
			this.abortController.abort();
		}
		this.abortController = new AbortController();

		// Optimistically update nowPlaying
		this.now = {
			videoId: item.video_id,
			title: item.title,
			artists: item.artists,
			artistId: item.artist_id,
			artistRuns: item.artist_runs,
			thumbnail: item.thumbnail,
			duration: item.duration,
			streamClient: 'Web Audio (Adaptive Stream)',
			audioQuality: 'High (AAC / OPUS)',
			rating: item.rating ?? null,
			isVideo: item.is_video,
			explicit: item.explicit
		};
		emitWebEvent('now-playing', this.now);
		this.updateMediaSessionMetadata(item);

		try {
			const streamUrl = await this.resolveAudioStreamUrl(item.video_id, this.abortController.signal);
			if (!streamUrl) throw new Error('Could not resolve playable audio stream');

			this.audio.src = streamUrl;
			await this.audio.play();
			this.paused = false;
			emitWebEvent('playback-state', 'playing');
		} catch (e: any) {
			if (e.name === 'AbortError') return;
			console.error('Failed to load stream:', e);
			emitWebEvent('playback-notice', `Loading alternative stream for "${item.title}"...`);
			rotateInstance();
			// Attempt retry with rotated instance
			try {
				const retryUrl = await this.resolveAudioStreamUrl(item.video_id);
				if (retryUrl && this.audio) {
					this.audio.src = retryUrl;
					await this.audio.play();
					this.paused = false;
					emitWebEvent('playback-state', 'playing');
					return;
				}
			} catch {}
			emitWebEvent('playback-error', `Unable to stream "${item.title}".`);
		}
	}

	private async resolveAudioStreamUrl(videoId: string, signal?: AbortSignal): Promise<string | null> {
		for (let attempt = 0; attempt < INVIDIOUS_INSTANCES.length; attempt++) {
			const base = getInstance();
			try {
				const res = await fetch(`${base}/api/v1/videos/${encodeURIComponent(videoId)}`, {
					signal,
					headers: { Accept: 'application/json' }
				});
				if (!res.ok) {
					rotateInstance();
					continue;
				}
				const data = await res.json();
				if (Array.isArray(data.adaptiveFormats)) {
					// Prefer audio formats
					const audioFormats = data.adaptiveFormats.filter(
						(f: any) => f.type && f.type.startsWith('audio/') && f.url
					);
					if (audioFormats.length > 0) {
						// Pick highest bitrate audio
						audioFormats.sort((a: any, b: any) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
						return audioFormats[0].url;
					}
				}
				if (Array.isArray(data.formatStreams) && data.formatStreams.length > 0) {
					return data.formatStreams[0].url;
				}
			} catch (e: any) {
				if (e.name === 'AbortError') throw e;
				rotateInstance();
			}
		}
		return null;
	}

	public pause(): void {
		this.audio?.pause();
		this.paused = true;
		emitWebEvent('playback-state', 'paused');
	}

	public resume(): void {
		this.audio?.play().catch(() => {});
		this.paused = false;
		emitWebEvent('playback-state', 'playing');
	}

	public togglePause(): void {
		if (this.paused) this.resume();
		else this.pause();
	}

	public seek(pos: number): void {
		if (!this.audio) return;
		this.audio.currentTime = pos;
		this.position = pos;
		emitWebEvent('position', pos);
	}

	public setVolume(vol: number): void {
		this.volume = Math.max(0, Math.min(100, vol));
		if (this.audio) {
			this.audio.volume = this.volume / 100;
		}
		emitWebEvent('volume', this.volume);
	}

	public nextTrack(): void {
		if (!this.queue.items.length) return;
		if (this.queue.repeat === 'one') {
			this.seek(0);
			this.resume();
			return;
		}
		let nextIdx = this.queue.currentIndex + 1;
		if (nextIdx >= this.queue.items.length) {
			if (this.queue.repeat === 'all') {
				nextIdx = 0;
			} else {
				this.pause();
				return;
			}
		}
		void this.playIndex(nextIdx);
	}

	public prevTrack(): void {
		if (!this.audio || !this.queue.items.length) return;
		if (this.audio.currentTime > 3) {
			this.seek(0);
			return;
		}
		let prevIdx = this.queue.currentIndex - 1;
		if (prevIdx < 0) {
			prevIdx = this.queue.repeat === 'all' ? this.queue.items.length - 1 : 0;
		}
		void this.playIndex(prevIdx);
	}

	private handleTrackEnded(): void {
		this.nextTrack();
	}
}

export const webPlayer = new WebAudioEngine();

// ---------------------------------------------------------------------------
// Web Data & Invidious / LRCLIB API handlers
// ---------------------------------------------------------------------------

export async function webSearch(query: string): Promise<SongItem[]> {
	const base = getInstance();
	try {
		const res = await fetch(
			`${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`,
			{ headers: { Accept: 'application/json' } }
		);
		if (!res.ok) return [];
		const data = await res.json();
		if (!Array.isArray(data)) return [];

		return data.map((v: any) => ({
			video_id: v.videoId,
			title: v.title,
			artists: v.author,
			artist_id: v.authorId,
			duration: formatDuration(v.lengthSeconds),
			thumbnail: v.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
			rating: 'indifferent' as const
		}));
	} catch (e) {
		console.warn('Web search error:', e);
		return [];
	}
}

export async function webGetLyrics(
	title: string,
	artist: string,
	duration?: number
): Promise<any> {
	try {
		const params = new URLSearchParams({
			track_name: title,
			artist_name: artist
		});
		if (duration) params.set('duration', String(Math.round(duration)));

		const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
		if (!res.ok) {
			// Try fallback search
			const sRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(`${title} ${artist}`)}`);
			if (!sRes.ok) return null;
			const list = await sRes.json();
			if (!Array.isArray(list) || !list.length) return null;
			return formatLrcResponse(list[0]);
		}
		const data = await res.json();
		return formatLrcResponse(data);
	} catch {
		return null;
	}
}

function formatLrcResponse(data: any) {
	if (!data) return null;
	if (data.syncedLyrics) {
		const lines = data.syncedLyrics
			.split('\n')
			.map((line: string) => {
				const match = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
				if (!match) return null;
				const min = parseInt(match[1], 10);
				const sec = parseFloat(match[2]);
				return { time: min * 60 + sec, text: match[3].trim() };
			})
			.filter(Boolean);
		return {
			source: 'LRCLIB',
			synced: true,
			instrumental: data.instrumental || false,
			lines
		};
	}
	if (data.plainLyrics) {
		const lines = data.plainLyrics
			.split('\n')
			.map((text: string) => ({ time: 0, text }));
		return {
			source: 'LRCLIB',
			synced: false,
			instrumental: false,
			lines
		};
	}
	return null;
}

function formatDuration(sec: number): string {
	if (!sec || isNaN(sec)) return '3:00';
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ---------------------------------------------------------------------------
// Curated Initial Home Feed for Web
// ---------------------------------------------------------------------------
export async function webGetHome(): Promise<HomePage> {
	// Try live trending music from Invidious
	const base = getInstance();
	let trendingItems: BrowseItem[] = [];
	try {
		const res = await fetch(`${base}/api/v1/trending?type=music`);
		if (res.ok) {
			const list = await res.json();
			if (Array.isArray(list)) {
				trendingItems = list.slice(0, 16).map((v: any) => ({
					kind: 'song' as const,
					id: v.videoId,
					title: v.title,
					subtitle: v.author,
					thumbnail: v.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
					duration: formatDuration(v.lengthSeconds)
				}));
			}
		}
	} catch (e) {
		console.warn('Failed to load trending items:', e);
	}

	// Fallback curated popular songs if network is offline or throttled
	if (!trendingItems.length) {
		trendingItems = [
			{
				kind: 'song',
				id: 'fHI8X4OXluQ',
				title: 'Blinding Lights',
				subtitle: 'The Weeknd',
				thumbnail: 'https://i.ytimg.com/vi/fHI8X4OXluQ/hqdefault.jpg',
				duration: '3:20'
			},
			{
				kind: 'song',
				id: 'L0MK7qz13bU',
				title: 'Starboy',
				subtitle: 'The Weeknd ft. Daft Punk',
				thumbnail: 'https://i.ytimg.com/vi/L0MK7qz13bU/hqdefault.jpg',
				duration: '3:50'
			},
			{
				kind: 'song',
				id: 'JGwWNGJdvx8',
				title: 'Shape of You',
				subtitle: 'Ed Sheeran',
				thumbnail: 'https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg',
				duration: '3:53'
			},
			{
				kind: 'song',
				id: 'H5v3kku4y6Q',
				title: 'As It Was',
				subtitle: 'Harry Styles',
				thumbnail: 'https://i.ytimg.com/vi/H5v3kku4y6Q/hqdefault.jpg',
				duration: '2:47'
			},
			{
				kind: 'song',
				id: '0Vwqpox_M-M',
				title: 'Nightcall',
				subtitle: 'Kavinsky',
				thumbnail: 'https://i.ytimg.com/vi/0Vwqpox_M-M/hqdefault.jpg',
				duration: '4:19'
			}
		];
	}

	return {
		chips: [
			{ title: 'Relax', params: 'relax' },
			{ title: 'Workout', params: 'workout' },
			{ title: 'Focus', params: 'focus' },
			{ title: 'Energize', params: 'energize' },
			{ title: 'Commute', params: 'commute' }
		],
		sections: [
			{
				title: 'Trending Music',
				items: trendingItems.slice(0, 8)
			},
			{
				title: 'Quick Picks',
				items: trendingItems.slice(8, 16).length ? trendingItems.slice(8, 16) : trendingItems.slice(0, 8)
			}
		]
	};
}

// ---------------------------------------------------------------------------
// Main Web IPC Dispatcher
// ---------------------------------------------------------------------------
export async function handleWebInvoke<T>(cmd: string, args?: Record<string, any>): Promise<T> {
	switch (cmd) {
		case 'get_home': {
			try {
				const res = await ytmGetHome(args?.params);
				if (res.sections.length > 0) return res as unknown as T;
			} catch {}
			return (await webGetHome()) as unknown as T;
		}

		case 'get_home_more':
			return { chips: [], sections: [] } as unknown as T;

		case 'search': {
			try {
				const songs = await ytmSearchSongs(args?.query || '');
				if (songs.length > 0) return songs as unknown as T;
			} catch {}
			return (await webSearch(args?.query || '')) as unknown as T;
		}

		case 'search_all': {
			try {
				const res = await ytmSearchAll(args?.query || '');
				if (res.songs.length > 0 || res.albums.length > 0 || res.artists.length > 0) {
					return res as unknown as T;
				}
			} catch {}
			const songs = await webSearch(args?.query || '');
			return {
				top: [],
				songs: songs.map((s) => ({
					kind: 'song' as const,
					id: s.video_id,
					title: s.title,
					subtitle: s.artists,
					thumbnail: s.thumbnail,
					duration: s.duration
				})),
				albums: [],
				artists: [],
				playlists: []
			} as unknown as T;
		}

		case 'search_cards': {
			try {
				const all = await ytmSearchAll(args?.query || '');
				if (args?.category === 'albums') return all.albums as unknown as T;
				if (args?.category === 'artists') return all.artists as unknown as T;
				if (args?.category === 'playlists') return all.playlists as unknown as T;
				return all.songs as unknown as T;
			} catch {
				return [] as unknown as T;
			}
		}

		case 'get_playlist': {
			if (args?.id) {
				const res = await ytmGetPlaylist(args.id);
				return res as unknown as T;
			}
			return { title: 'Playlist', items: [], owned: false, collaborative: false } as unknown as T;
		}

		case 'get_album': {
			if (args?.id) {
				const res = await ytmGetAlbum(args.id);
				return res as unknown as T;
			}
			return { title: 'Album', items: [], inLibrary: false } as unknown as T;
		}

		case 'get_artist': {
			if (args?.id) {
				const res = await ytmGetArtist(args.id);
				return res as unknown as T;
			}
			return { name: 'Artist', channelId: args?.id || '', subscribed: false, topSongs: [], sections: [] } as unknown as T;
		}

		case 'play':
			if (args?.item) await webPlayer.play(args.item);
			return undefined as unknown as T;

		case 'play_index':
			if (args?.index !== undefined) await webPlayer.playIndex(args.index);
			return undefined as unknown as T;

		case 'play_playlist':
			await webPlayer.playPlaylist(
				args?.items || [],
				args?.start ?? 0,
				args?.source_id,
				args?.source_title,
				args?.shuffle
			);
			return undefined as unknown as T;

		case 'play_next': {
			const items: SongItem[] = args?.items || [];
			if (items.length) {
				const curr = webPlayer.queue.currentIndex;
				webPlayer.queue.items.splice(curr + 1, 0, ...items);
				emitWebEvent('queue-changed', webPlayer.queue);
			}
			return undefined as unknown as T;
		}

		case 'add_to_queue': {
			const items: SongItem[] = args?.items || [];
			if (items.length) {
				webPlayer.queue.items.push(...items);
				emitWebEvent('queue-changed', webPlayer.queue);
			}
			return undefined as unknown as T;
		}

		case 'clear_queued':
			webPlayer.queue.items = webPlayer.queue.items.slice(0, webPlayer.queue.currentIndex + 1);
			emitWebEvent('queue-changed', webPlayer.queue);
			return undefined as unknown as T;

		case 'remove_from_queue':
			if (args?.index !== undefined && args.index !== webPlayer.queue.currentIndex) {
				webPlayer.queue.items.splice(args.index, 1);
				if (args.index < webPlayer.queue.currentIndex) {
					webPlayer.queue.currentIndex--;
				}
				emitWebEvent('queue-changed', webPlayer.queue);
			}
			return undefined as unknown as T;

		case 'move_in_queue':
			if (args?.from !== undefined && args?.to !== undefined) {
				const [item] = webPlayer.queue.items.splice(args.from, 1);
				webPlayer.queue.items.splice(args.to, 0, item);
				emitWebEvent('queue-changed', webPlayer.queue);
			}
			return undefined as unknown as T;

		case 'next_track':
			webPlayer.nextTrack();
			return undefined as unknown as T;

		case 'prev_track':
			webPlayer.prevTrack();
			return undefined as unknown as T;

		case 'toggle_pause':
			webPlayer.togglePause();
			return undefined as unknown as T;

		case 'seek':
			if (args?.position !== undefined) webPlayer.seek(args.position);
			return undefined as unknown as T;

		case 'set_volume':
			if (args?.volume !== undefined) webPlayer.setVolume(args.volume);
			return undefined as unknown as T;

		case 'set_repeat':
			if (args?.mode) {
				webPlayer.queue.repeat = args.mode as RepeatMode;
				emitWebEvent('queue-changed', webPlayer.queue);
			}
			return undefined as unknown as T;

		case 'toggle_shuffle':
			webPlayer.queue.shuffle = !webPlayer.queue.shuffle;
			emitWebEvent('queue-changed', webPlayer.queue);
			return undefined as unknown as T;

		case 'get_queue':
			return webPlayer.queue as unknown as T;

		case 'get_settings': {
			if (typeof localStorage === 'undefined') return {} as unknown as T;
			try {
				const raw = localStorage.getItem('nocturne_web_settings');
				return (raw ? JSON.parse(raw) : {}) as unknown as T;
			} catch {
				return {} as unknown as T;
			}
		}

		case 'set_setting': {
			if (typeof localStorage !== 'undefined' && args?.key) {
				try {
					const raw = localStorage.getItem('nocturne_web_settings');
					const current = raw ? JSON.parse(raw) : {};
					current[args.key] = args.value;
					localStorage.setItem('nocturne_web_settings', JSON.stringify(current));
				} catch {}
			}
			return undefined as unknown as T;
		}

		case 'get_account':
			return (await ytmGetAccount()) as unknown as T;

		case 'login_webview':
			openLoginModal();
			return undefined as unknown as T;

		case 'sign_out':
			setStoredCookie(null);
			emitWebEvent('auth-changed', { signedIn: false });
			return undefined as unknown as T;

		case 'get_account_identities':
			return [] as unknown as T;

		case 'get_saved_accounts':
			return [] as unknown as T;

		case 'get_library':
		case 'get_library_albums':
		case 'get_library_artists':
		case 'get_local_library':
			return [] as unknown as T;

		case 'can_self_update':
			return false as unknown as T;

		case 'lastfm_status':
			return { connected: false } as unknown as T;

		case 'spotify_status':
			return { linked: false } as unknown as T;

		case 'spotify_get_sync_mode':
			return 'seperate' as unknown as T;

		case 'spotify_get_playlists':
			return [] as unknown as T;

		case 'get_remote_sync_status':
			return { enabled: false, port: 0, ips: [] } as unknown as T;

		case 'get_remote_sync_paired_devices':
			return [] as unknown as T;

		case 'open_external':
			if (args?.url && typeof window !== 'undefined') {
				window.open(args.url, '_blank');
			}
			return undefined as unknown as T;

		case 'search_lyrics_candidates':
			if (args?.title && args?.artist) {
				const lrc = await webGetLyrics(args.title, args.artist, args.duration_seconds);
				return (lrc ? [lrc] : []) as unknown as T;
			}
			return [] as unknown as T;

		default:
			// Graceful no-op for any unhandled commands
			return undefined as unknown as T;
	}
}
