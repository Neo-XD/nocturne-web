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
	ytmGetPlaylistMore,
	ytmGetAccount,
	ytmGetLibraryPlaylists,
	ytmGetLibraryAlbums,
	ytmGetLibraryArtists,
	ytmGetSongRadio,
	ytmSearchCards,
	setStoredCookie,
	getApiBaseUrl
} from './ytmusic';
import {
	getStoredOAuthSession,
	clearOAuthSession,
	fetchOAuthPlaylistPage,
	fetchOAuthPlaylistContinuation,
	fetchOAuthUserPlaylists
} from './oauth';
import { openLoginModal } from './loginModal.svelte';

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
// Hybrid YouTube IFrame & HTML5 Web Audio Playback Engine
// ---------------------------------------------------------------------------
let ytApiPromise: Promise<void> | null = null;
function loadYouTubeIframeApi(): Promise<void> {
	if (typeof window === 'undefined') return Promise.reject(new Error('Window not available'));
	if ((window as any).YT && (window as any).YT.Player) {
		return Promise.resolve();
	}
	if (ytApiPromise) return ytApiPromise;

	ytApiPromise = new Promise((resolve) => {
		const prev = (window as any).onYouTubeIframeAPIReady;
		(window as any).onYouTubeIframeAPIReady = () => {
			if (typeof prev === 'function') prev();
			resolve();
		};

		if (!document.getElementById('nocturne-yt-iframe-script')) {
			const tag = document.createElement('script');
			tag.id = 'nocturne-yt-iframe-script';
			tag.src = 'https://www.youtube.com/iframe_api';
			document.head.appendChild(tag);
		}
	});
	return ytApiPromise;
}

class WebAudioEngine {
	private audio: HTMLAudioElement | null = null;
	private ytPlayer: any = null;
	private ytReady = false;
	private ytInitPromise: Promise<any> | null = null;
	private progressInterval: any = null;

	public queue: QueueState = {
		items: [],
		currentIndex: 0,
		shuffle: false,
		repeat: 'off',
		sourceName: null
	};
	public activeMode: 'youtube' | 'audio' | 'none' = 'none';
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
				if (this.activeMode !== 'audio' || !this.audio) return;
				this.position = this.audio.currentTime;
				emitWebEvent('position', this.position);
			});

			this.audio.addEventListener('durationchange', () => {
				if (this.activeMode !== 'audio' || !this.audio || !Number.isFinite(this.audio.duration)) return;
				this.duration = this.audio.duration;
				emitWebEvent('duration', this.duration);
			});

			this.audio.addEventListener('loadedmetadata', () => {
				if (this.activeMode !== 'audio' || !this.audio || !Number.isFinite(this.audio.duration)) return;
				this.duration = this.audio.duration;
				emitWebEvent('duration', this.duration);
			});

			this.audio.addEventListener('play', () => {
				if (this.activeMode !== 'audio') return;
				this.paused = false;
				emitWebEvent('playback-state', 'playing');
				this.startProgressTicker();
			});

			this.audio.addEventListener('pause', () => {
				if (this.activeMode !== 'audio') return;
				this.paused = true;
				emitWebEvent('playback-state', 'paused');
			});

			this.audio.addEventListener('ended', () => {
				if (this.activeMode !== 'audio') return;
				this.handleTrackEnded();
			});

			this.audio.addEventListener('error', (e) => {
				if (this.activeMode !== 'audio') return;
				console.warn('HTML5 Audio playback error:', e);
				emitWebEvent('playback-error', 'Playback stream error. Skipping to next track...');
				setTimeout(() => this.nextTrack(), 1500);
			});

			this.setupMediaSession();
			// Preload YouTube Iframe API in the background
			loadYouTubeIframeApi().catch(() => {});
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

	private async ensureYtPlayer(initialVideoId?: string): Promise<any> {
		if (typeof window === 'undefined') return null;
		if (this.ytPlayer && this.ytReady) return this.ytPlayer;
		if (this.ytInitPromise) return this.ytInitPromise;

		this.ytInitPromise = new Promise(async (resolve, reject) => {
			try {
				await loadYouTubeIframeApi();

				let container = document.getElementById('nocturne-yt-container');
				if (!container) {
					container = document.createElement('div');
					container.id = 'nocturne-yt-container';
					container.setAttribute('aria-hidden', 'true');
					container.style.cssText =
						'position:fixed;bottom:-9999px;left:-9999px;width:200px;height:200px;opacity:0.001;pointer-events:none;z-index:-9999;';
					document.body.appendChild(container);
				}

				let mountEl = document.getElementById('nocturne-yt-iframe');
				if (!mountEl) {
					mountEl = document.createElement('div');
					mountEl.id = 'nocturne-yt-iframe';
					container.appendChild(mountEl);
				}

				const YT = (window as any).YT;
				this.ytPlayer = new YT.Player('nocturne-yt-iframe', {
					width: '200',
					height: '200',
					videoId: initialVideoId || '',
					playerVars: {
						autoplay: 1,
						controls: 0,
						disablekb: 1,
						fs: 0,
						rel: 0,
						modestbranding: 1,
						playsinline: 1,
						origin: window.location.origin
					},
					events: {
						onReady: (event: any) => {
							this.ytReady = true;
							event.target.setVolume(this.volume);
							this.startProgressTicker();
							resolve(this.ytPlayer);
						},
						onStateChange: (event: any) => {
							// 1 = playing, 2 = paused, 0 = ended, 3 = buffering
							if (event.data === 1) {
								this.paused = false;
								emitWebEvent('playback-state', 'playing');
								this.startProgressTicker();
							} else if (event.data === 2) {
								this.paused = true;
								emitWebEvent('playback-state', 'paused');
							} else if (event.data === 0) {
								this.handleTrackEnded();
							}
						},
						onError: (err: any) => {
							console.warn('YouTube IFrame player error:', err);
							if (this.now) {
								this.fallbackToAudioElement(this.now.videoId, this.now.title);
							}
						}
					}
				});
			} catch (err) {
				this.ytInitPromise = null;
				reject(err);
			}
		});

		return this.ytInitPromise;
	}

	private startProgressTicker() {
		if (this.progressInterval) clearInterval(this.progressInterval);
		this.progressInterval = setInterval(() => {
			if (this.paused) return;

			if (this.activeMode === 'youtube' && this.ytPlayer && this.ytReady) {
				try {
					const cur = this.ytPlayer.getCurrentTime();
					const dur = this.ytPlayer.getDuration();
					if (typeof cur === 'number' && Number.isFinite(cur) && cur >= 0) {
						this.position = cur;
						emitWebEvent('position', cur);
						emitWebEvent('position', { position: cur });
					}
					if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
						this.duration = dur;
						emitWebEvent('duration', dur);
						emitWebEvent('duration', { duration: dur });
					}
				} catch {}
			} else if (this.activeMode === 'audio' && this.audio) {
				if (Number.isFinite(this.audio.currentTime)) {
					this.position = this.audio.currentTime;
					emitWebEvent('position', this.position);
					emitWebEvent('position', { position: this.position });
				}
				if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
					this.duration = this.audio.duration;
					emitWebEvent('duration', this.duration);
					emitWebEvent('duration', { duration: this.duration });
				}
			}
		}, 250);
	}

	public async play(item: SongItem): Promise<void> {
		const existingIndex = this.queue.items.findIndex((i) => i.video_id === item.video_id);
		if (existingIndex !== -1) {
			this.queue.currentIndex = existingIndex;
		} else {
			this.queue.items = [item];
			this.queue.currentIndex = 0;
			this.queue.sourceName = `${item.title} Radio`;
		}

		emitWebEvent('queue-changed', this.queue);
		await this.loadAndStreamTrack(item);

		// Populate autoplay / radio queue in background so endless play works
		void this.fillRadioQueue(item.video_id);
	}

	public async fillRadioQueue(videoId: string): Promise<void> {
		try {
			const radioTracks = await ytmGetSongRadio(videoId);
			if (!radioTracks.length) return;
			const existingIds = new Set(this.queue.items.map((i) => i.video_id));
			const toAdd = radioTracks.filter((t) => !existingIds.has(t.video_id));
			if (toAdd.length > 0) {
				this.queue.items = [...this.queue.items, ...toAdd];
				emitWebEvent('queue-changed', this.queue);
			}
		} catch (e) {
			console.debug('Failed to fill radio queue:', e);
		}
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
			streamClient: 'YouTube Direct Web Player',
			audioQuality: 'High (AAC / OPUS)',
			rating: item.rating ?? null,
			isVideo: item.is_video,
			explicit: item.explicit
		};
		emitWebEvent('now-playing', this.now);
		this.updateMediaSessionMetadata(item);

		// Reset position and set duration if item has duration
		this.position = 0;
		emitWebEvent('position', { position: 0 });
		if (item.duration) {
			const parts = item.duration.split(':').map(Number);
			if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
				this.duration = parts[0] * 60 + parts[1];
				emitWebEvent('duration', { duration: this.duration });
			} else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
				this.duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
				emitWebEvent('duration', { duration: this.duration });
			}
		}

		// Try YouTube IFrame Player first (runs directly in user browser, zero bot checks, plays all songs)
		try {
			await this.ensureYtPlayer(item.video_id);
			if (this.ytPlayer && this.ytReady) {
				if (this.audio) {
					this.audio.pause();
					this.audio.src = '';
				}
				this.activeMode = 'youtube';
				this.ytPlayer.loadVideoById(item.video_id);
				this.ytPlayer.playVideo();
				this.paused = false;
				this.startProgressTicker();
				emitWebEvent('playback-state', 'playing');
				return;
			}
		} catch (e) {
			console.warn('YouTube IFrame player initialization failed, using HTML5 audio fallback:', e);
		}

		// Fallback to HTML5 audio via /api/stream
		await this.fallbackToAudioElement(item.video_id, item.title);
	}

	private async fallbackToAudioElement(videoId: string, title?: string): Promise<void> {
		if (!this.audio) return;
		try {
			this.activeMode = 'audio';
			const apiBase = getApiBaseUrl();
			const streamUrl = `${apiBase}/api/stream?id=${encodeURIComponent(videoId)}`;
			this.audio.src = streamUrl;
			await this.audio.play();
			this.paused = false;
			this.startProgressTicker();
			emitWebEvent('playback-state', 'playing');
		} catch (e: any) {
			if (e.name === 'AbortError') return;
			console.error('Failed to load stream:', e);
			emitWebEvent('playback-error', `Unable to stream "${title || 'track'}".`);
		}
	}

	public pause(): void {
		this.paused = true;
		if (this.ytPlayer && this.ytReady) {
			try {
				this.ytPlayer.pauseVideo();
			} catch {}
		}
		if (this.audio) {
			this.audio.pause();
		}
		emitWebEvent('playback-state', 'paused');
	}

	public resume(): void {
		this.paused = false;
		if (this.ytPlayer && this.ytReady) {
			try {
				this.ytPlayer.playVideo();
			} catch {}
		} else if (this.audio) {
			this.audio.play().catch(() => {});
		}
		this.startProgressTicker();
		emitWebEvent('playback-state', 'playing');
	}

	public togglePause(): void {
		if (this.paused) this.resume();
		else this.pause();
	}

	public seek(pos: number): void {
		this.position = pos;
		if (this.activeMode === 'youtube' && this.ytPlayer && this.ytReady) {
			try {
				this.ytPlayer.seekTo(pos, true);
			} catch {}
		}
		if (this.audio) {
			this.audio.currentTime = pos;
		}
		emitWebEvent('position', pos);
		emitWebEvent('position', { position: pos });
	}

	public setVolume(vol: number): void {
		this.volume = Math.max(0, Math.min(100, vol));
		if (this.ytPlayer && this.ytReady) {
			try {
				this.ytPlayer.setVolume(this.volume);
			} catch {}
		}
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
				const current = this.queue.items[this.queue.currentIndex];
				if (current) {
					void this.fillRadioQueue(current.video_id).then(() => {
						if (this.queue.currentIndex + 1 < this.queue.items.length) {
							void this.playIndex(this.queue.currentIndex + 1);
						} else {
							this.pause();
						}
					});
					return;
				}
				this.pause();
				return;
			}
		}
		void this.playIndex(nextIdx);
	}

	public prevTrack(): void {
		if (!this.queue.items.length) return;
		if (this.position > 3) {
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
// LRCLIB API handlers
// ---------------------------------------------------------------------------

export async function webGetLyrics(
	title: string,
	artist: string,
	duration?: number,
	album?: string,
	videoId?: string
): Promise<any> {
	const cleanTitle = title
		.replace(/\(Official.*?\)/gi, '')
		.replace(/\[Official.*?\]/gi, '')
		.replace(/\(Audio\)/gi, '')
		.replace(/\(Lyric.*?\)/gi, '')
		.replace(/\|.*$/g, '')
		.trim();

	const cleanArtist = artist.split(',')[0].split('•')[0].trim();

	try {
		const params = new URLSearchParams({
			track_name: cleanTitle,
			artist_name: cleanArtist
		});
		if (duration) params.set('duration', String(Math.round(duration)));

		const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
		if (res.ok) {
			const data = await res.json();
			const formatted = formatLrcResponse(data);
			if (formatted) return formatted;
		}

		// Fallback search on lrclib
		const sRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanTitle} ${cleanArtist}`)}`);
		if (sRes.ok) {
			const list = await sRes.json();
			if (Array.isArray(list) && list.length > 0) {
				const formatted = formatLrcResponse(list[0]);
				if (formatted) return formatted;
			}
		}
	} catch (e) {
		console.warn('Lyrics fetch error:', e);
	}

	return null;
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
				return {
					time_ms: Math.round((min * 60 + sec) * 1000),
					text: match[3].trim()
				};
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
			.map((text: string) => ({ text: text.trim() }))
			.filter((l: any) => l.text.length > 0);
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
// Curated Initial Home Feed for Web Fallback
// ---------------------------------------------------------------------------
export async function webGetHome(): Promise<HomePage> {
	try {
		const songs = await ytmSearchSongs('Top Hits');
		if (songs.length > 0) {
			const items: BrowseItem[] = songs.slice(0, 12).map((s) => ({
				kind: 'song',
				id: s.video_id,
				title: s.title,
				subtitle: s.artists,
				thumbnail: s.thumbnail,
				duration: s.duration
			}));
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
						items: items.slice(0, 6)
					},
					{
						title: 'Quick Picks',
						items: items.slice(6, 12).length ? items.slice(6, 12) : items.slice(0, 6)
					}
				]
			};
		}
	} catch (e) {
		console.warn('webGetHome ytmSearchSongs error:', e);
	}

	const curatedItems: BrowseItem[] = [
		{
			kind: 'song',
			id: '4NRXx6U8ABQ',
			title: 'Blinding Lights',
			subtitle: 'The Weeknd',
			thumbnail: 'https://lh3.googleusercontent.com/9T56V6wE_jZgT9d-t1H5qR7J8rS_v4pL0m2k3h4g',
			duration: '3:20'
		}
	];

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
				items: curatedItems
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
				if (res && res.sections && res.sections.length > 0) return res as unknown as T;
			} catch (e) {
				console.warn('ytmGetHome failed, falling back:', e);
			}
			try {
				const fallback = await webGetHome();
				return fallback as unknown as T;
			} catch (fbErr) {
				console.warn('webGetHome failed, using hardcoded fallback:', fbErr);
				return {
					chips: [
						{ title: 'Relax', params: 'relax' },
						{ title: 'Workout', params: 'workout' },
						{ title: 'Focus', params: 'focus' },
						{ title: 'Energize', params: 'energize' }
					],
					sections: [
						{
							title: 'Trending Music',
							items: [
								{
									kind: 'song',
									id: '4NRXx6U8ABQ',
									title: 'Blinding Lights',
									subtitle: 'The Weeknd',
									thumbnail: 'https://lh3.googleusercontent.com/9T56V6wE_jZgT9d-t1H5qR7J8rS_v4pL0m2k3h4g',
									duration: '3:20'
								}
							]
						}
					]
				} as unknown as T;
			}
		}

		case 'get_home_more':
			return { chips: [], sections: [] } as unknown as T;

		case 'search': {
			try {
				const songs = await ytmSearchSongs(args?.query || '');
				return songs as unknown as T;
			} catch (e) {
				console.warn('ytmSearchSongs error:', e);
				return [] as unknown as T;
			}
		}

		case 'search_all': {
			try {
				const res = await ytmSearchAll(args?.query || '');
				return res as unknown as T;
			} catch (e) {
				console.warn('ytmSearchAll error:', e);
				return {
					top: [],
					songs: [],
					albums: [],
					artists: [],
					playlists: []
				} as unknown as T;
			}
		}

		case 'search_cards': {
			const query = args?.query || '';
			const category = args?.category || '';
			try {
				const cards = await ytmSearchCards(query, category);
				if (cards.length > 0) return cards as unknown as T;
				const all = await ytmSearchAll(query);
				if (category === 'albums') return all.albums as unknown as T;
				if (category === 'artists') return all.artists as unknown as T;
				if (category === 'playlists') return all.playlists as unknown as T;
				return all.songs as unknown as T;
			} catch (e) {
				console.warn('search_cards error:', e);
				return [] as unknown as T;
			}
		}

		case 'get_playlist': {
			if (args?.id) {
				const id = args.id as string;
				const cleanId = id.replace(/^VL/, '');
				const isLiked = cleanId === 'LM' || cleanId === 'LL' || cleanId === 'VLLM' || cleanId === 'FEmusic_liked_videos';
				const isUserPlaylist = cleanId.startsWith('PL');
				const oauthSession = getStoredOAuthSession();

				// Fast path: for liked music or user playlists when logged in with OAuth,
				// fetch directly from YouTube Data API v3 without waiting for InnerTube to time out
				if (oauthSession && (isLiked || isUserPlaylist)) {
					try {
						const oauthPl = await fetchOAuthPlaylistPage(id);
						if (oauthPl && oauthPl.items.length > 0) return oauthPl as unknown as T;
					} catch (e) {
						console.warn('OAuth playlist page error:', e);
					}
				}

				const res = await ytmGetPlaylist(id);
				if (res && res.items.length > 0) return res as unknown as T;

				if (oauthSession && !isLiked && !isUserPlaylist) {
					try {
						const oauthPl = await fetchOAuthPlaylistPage(id);
						if (oauthPl && oauthPl.items.length > 0) return oauthPl as unknown as T;
					} catch (e) {
						console.warn('OAuth playlist page fallback error:', e);
					}
				}
				return res as unknown as T;
			}
			return { title: 'Playlist', items: [], owned: false, collaborative: false } as unknown as T;
		}

		case 'get_playlist_more': {
			const token = args?.token as string | undefined;
			if (!token) return { items: [] } as unknown as T;
			if (token.startsWith('oauth:')) {
				const parts = token.slice(6).split(':');
				const id = parts[0];
				const pageToken = parts.slice(1).join(':');
				const res = await fetchOAuthPlaylistContinuation(id, pageToken);
				if (res) return res as unknown as T;
				return { items: [] } as unknown as T;
			}
			try {
				const res = await ytmGetPlaylistMore(token);
				return res as unknown as T;
			} catch (e) {
				console.warn('ytmGetPlaylistMore error:', e);
				return { items: [] } as unknown as T;
			}
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

		case 'start_radio': {
			const id = args?.id as string | undefined;
			const name = args?.name as string | undefined;
			if (id) {
				const radioTracks = await ytmGetSongRadio(id);
				if (radioTracks.length > 0) {
					await webPlayer.playPlaylist(radioTracks, 0, id, name ? `${name} Radio` : 'Radio');
				}
			}
			return undefined as unknown as T;
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

		case 'get_playback':
			return {
				now: webPlayer.now,
				paused: webPlayer.paused,
				position: webPlayer.position,
				duration: webPlayer.duration,
				volume: webPlayer.volume
			} as unknown as T;

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

		case 'get_account': {
			const oauthSession = getStoredOAuthSession();
			if (oauthSession?.account) return oauthSession.account as unknown as T;
			return (await ytmGetAccount()) as unknown as T;
		}

		case 'login_webview':
			openLoginModal();
			return undefined as unknown as T;

		case 'sign_out':
			clearOAuthSession();
			setStoredCookie(null);
			emitWebEvent('auth-changed', { signedIn: false });
			return undefined as unknown as T;

		case 'get_account_identities':
			return [] as unknown as T;

		case 'get_saved_accounts':
			return [] as unknown as T;

		case 'get_library': {
			const oauthSession = getStoredOAuthSession();
			const cookie = typeof localStorage !== 'undefined' ? localStorage.getItem('nocturne_ytm_cookie') : null;

			const promises: Promise<BrowseItem[]>[] = [];
			// Only call InnerTube library playlists if a cookie is present (guest browse on FEmusic_liked_playlists fails)
			if (cookie) {
				promises.push(ytmGetLibraryPlaylists().catch(() => []));
			}
			if (oauthSession) {
				promises.push(fetchOAuthUserPlaylists().catch(() => []));
			}

			const results = await Promise.allSettled(promises);
			const items: BrowseItem[] = [];

			for (const res of results) {
				if (res.status === 'fulfilled' && Array.isArray(res.value)) {
					for (const p of res.value) {
						if (!items.some((i) => i.id === p.id)) {
							items.push(p);
						}
					}
				}
			}

			// Always guarantee Liked Music is present if user has a session or cookie
			if ((oauthSession || cookie) && !items.some((i) => i.id === 'VLLM' || i.id === 'LM')) {
				items.unshift({
					kind: 'playlist',
					id: 'VLLM',
					title: 'Liked Music',
					subtitle: 'Auto playlist'
				});
			}

			return items as unknown as T;
		}

		case 'get_library_albums': {
			try {
				const albums = await ytmGetLibraryAlbums();
				return albums as unknown as T;
			} catch {
				return [] as unknown as T;
			}
		}

		case 'get_library_artists': {
			try {
				const artists = await ytmGetLibraryArtists();
				return artists as unknown as T;
			} catch {
				return [] as unknown as T;
			}
		}

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

		case 'get_lyrics': {
			const title = args?.title;
			const artists = args?.artists || args?.artist;
			if (title && artists) {
				const lrc = await webGetLyrics(title, artists, args?.duration, args?.album, args?.videoId);
				return lrc as unknown as T;
			}
			return null as unknown as T;
		}

		case 'search_lyrics_candidates':
			if (args?.title && (args?.artist || args?.artists)) {
				const lrc = await webGetLyrics(args.title, args.artist || args.artists, args.duration_seconds);
				return (lrc ? [lrc] : []) as unknown as T;
			}
			return [] as unknown as T;

		case 'download_song': {
			if (args?.videoId && typeof window !== 'undefined') {
				const title = args.title || 'track';
				const artist = args.artist || 'Unknown Artist';
				const cleanName = `${title} - ${artist}`.replace(/[^a-zA-Z0-9_\-\. ]/g, '_');
				const apiBase = getApiBaseUrl();
				const a = document.createElement('a');
				a.href = `${apiBase}/api/stream?id=${encodeURIComponent(args.videoId)}&download=1&title=${encodeURIComponent(cleanName)}`;
				a.download = `${cleanName}.m4a`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				return 'Downloads folder' as unknown as T;
			}
			return 'Downloads' as unknown as T;
		}

		case 'download_playlist': {
			const items: SongItem[] = args?.items || [];
			if (typeof window !== 'undefined' && items.length > 0) {
				const apiBase = getApiBaseUrl();
				items.forEach((song, i) => {
					const cleanName = `${song.title} - ${song.artists}`.replace(/[^a-zA-Z0-9_\-\. ]/g, '_');
					setTimeout(() => {
						const a = document.createElement('a');
						a.href = `${apiBase}/api/stream?id=${encodeURIComponent(song.video_id)}&download=1&title=${encodeURIComponent(cleanName)}`;
						a.download = `${cleanName}.m4a`;
						document.body.appendChild(a);
						a.click();
						document.body.removeChild(a);
					}, i * 1500);
				});
				return 'Downloads folder' as unknown as T;
			}
			return 'Downloads' as unknown as T;
		}

		default:
			// Graceful no-op for any unhandled commands
			return undefined as unknown as T;
	}
}
