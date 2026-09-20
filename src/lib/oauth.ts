import type { Account, BrowseItem, PlaylistContinuation, PlaylistPage, SongItem } from './api';
import { emitWebEvent } from './webEngine';
import { writable } from 'svelte/store';

export interface OAuthSession {
	accessToken: string;
	expiresAt: number;
	account: Account;
}

const STORAGE_KEY_SESSION = 'nocturne_oauth_session';
const STORAGE_KEY_CLIENT_ID = 'nocturne_google_client_id';

// Default Google OAuth Client ID for Nocturne Web
const DEFAULT_CLIENT_ID = '1007597393955-55ukvkhn1rklol7cng6lej66g9dtubdk.apps.googleusercontent.com';

declare global {
	interface Window {
		google?: any;
	}
}

export function getGoogleClientId(): string {
	if (typeof localStorage === 'undefined') return DEFAULT_CLIENT_ID;
	return localStorage.getItem(STORAGE_KEY_CLIENT_ID) || DEFAULT_CLIENT_ID;
}

export function setGoogleClientId(clientId: string): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY_CLIENT_ID, clientId.trim());
}

export function getStoredOAuthSession(): OAuthSession | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY_SESSION);
		if (!raw) return null;
		const session: OAuthSession = JSON.parse(raw);
		// Check if expired
		if (Date.now() > session.expiresAt) {
			localStorage.removeItem(STORAGE_KEY_SESSION);
			return null;
		}
		return session;
	} catch {
		return null;
	}
}

export function saveOAuthSession(session: OAuthSession): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
}

export function clearOAuthSession(): void {
	if (typeof localStorage === 'undefined') return;
	const session = getStoredOAuthSession();
	if (session?.accessToken && window.google?.accounts?.oauth2?.revoke) {
		try {
			window.google.accounts.oauth2.revoke(session.accessToken, () => {});
		} catch {}
	}
	localStorage.removeItem(STORAGE_KEY_SESSION);
	emitWebEvent('auth-changed', { signedIn: false });
}

export async function loadGsiScript(): Promise<void> {
	if (typeof window === 'undefined') return;
	if (window.google?.accounts?.oauth2) return;

	return new Promise((resolve, reject) => {
		const existing = document.getElementById('google-gsi-script');
		if (existing) {
			existing.addEventListener('load', () => resolve());
			existing.addEventListener('error', (e) => reject(e));
			return;
		}

		const script = document.createElement('script');
		script.id = 'google-gsi-script';
		script.src = 'https://accounts.google.com/gsi/client';
		script.async = true;
		script.defer = true;
		script.onload = () => resolve();
		script.onerror = (e) => reject(e);
		document.head.appendChild(script);
	});
}

export async function signInWithGoogleOAuth(): Promise<Account> {
	const clientId = getGoogleClientId();
	if (!clientId) {
		throw new Error('Please configure a Google OAuth Client ID in Settings.');
	}

	await loadGsiScript();

	return new Promise((resolve, reject) => {
		if (!window.google?.accounts?.oauth2) {
			return reject(new Error('Google Identity Services failed to load.'));
		}

		const tokenClient = window.google.accounts.oauth2.initTokenClient({
			client_id: clientId,
			scope: [
				'https://www.googleapis.com/auth/userinfo.profile',
				'https://www.googleapis.com/auth/userinfo.email',
				'https://www.googleapis.com/auth/youtube.readonly'
			].join(' '),
			callback: async (tokenResponse: any) => {
				if (tokenResponse.error) {
					return reject(new Error(tokenResponse.error_description || tokenResponse.error));
				}

				try {
					const accessToken = tokenResponse.access_token;
					const expiresIn = parseInt(tokenResponse.expires_in, 10) || 3600;

					// Fetch Google user profile
					const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
						headers: { Authorization: `Bearer ${accessToken}` }
					});
					const profile = await userRes.json();

					// Try to fetch YouTube channel details
					let channelId: string | undefined = undefined;
					let channelHandle: string | undefined = undefined;
					let channelThumb: string | undefined = undefined;

					try {
						const ytRes = await fetch(
							'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
							{ headers: { Authorization: `Bearer ${accessToken}` } }
						);
						if (ytRes.ok) {
							const ytData = await ytRes.json();
							const ch = ytData.items?.[0];
							if (ch) {
								channelId = ch.id;
								channelHandle = ch.snippet?.customUrl || `@${ch.snippet?.title}`;
								channelThumb = ch.snippet?.thumbnails?.default?.url;
							}
						}
					} catch (e) {
						console.warn('Failed to fetch YouTube channel details:', e);
					}

					const account: Account = {
						signedIn: true,
						name: profile.name || 'Google User',
						email: profile.email,
						handle: channelHandle || profile.email,
						thumbnail: channelThumb || profile.picture,
						channelId
					};

					const session: OAuthSession = {
						accessToken,
						expiresAt: Date.now() + expiresIn * 1000,
						account
					};

					saveOAuthSession(session);
					emitWebEvent('auth-changed', account);
					resolve(account);
				} catch (err) {
					reject(err);
				}
			}
		});

		tokenClient.requestAccessToken({ prompt: 'consent' });
	});
}

export interface OAuthApiNotice {
	type: 'error' | 'warning' | 'info';
	message: string;
	link?: string;
	linkText?: string;
}

export const oauthApiNotice = writable<OAuthApiNotice | null>(null);

export function clearOAuthNotice(): void {
	oauthApiNotice.set(null);
}

export async function fetchOAuthUserPlaylists(): Promise<BrowseItem[]> {
	const session = getStoredOAuthSession();
	if (!session?.accessToken) return [];

	const baseItems: BrowseItem[] = [
		{
			kind: 'playlist',
			id: 'VLLM',
			title: 'Liked Music',
			subtitle: 'Auto playlist'
		}
	];

	try {
		const res = await fetch(
			'https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50',
			{ headers: { Authorization: `Bearer ${session.accessToken}` } }
		);

		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			console.warn('YouTube Data API playlist fetch failed:', res.status, err);

			if (res.status === 401) {
				clearOAuthSession();
				return baseItems;
			}

			if (res.status === 403) {
				oauthApiNotice.set({
					type: 'warning',
					message: 'YouTube Data API v3 is not enabled in your Google Cloud project. Enable it to sync your YouTube playlists.',
					link: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
					linkText: 'Enable YouTube Data API v3'
				});
			}
			return baseItems;
		}

		// Successfully retrieved playlists
		oauthApiNotice.set(null);
		const data = await res.json();
		const items: BrowseItem[] = (data.items || []).map((p: any) => ({
			kind: 'playlist' as const,
			id: p.id.startsWith('VL') ? p.id : `VL${p.id}`,
			title: p.snippet?.title || 'Untitled Playlist',
			subtitle: `${p.contentDetails?.itemCount || 0} tracks`,
			thumbnail:
				p.snippet?.thumbnails?.high?.url ||
				p.snippet?.thumbnails?.medium?.url ||
				p.snippet?.thumbnails?.default?.url
		}));

		return [...baseItems, ...items];
	} catch (e) {
		console.warn('Failed to fetch OAuth user playlists:', e);
		return baseItems;
	}
}

export function parseIsoDuration(durationStr?: string): string {
	if (!durationStr) return '3:00';
	const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
	if (!match) return '3:00';
	const hours = parseInt(match[1] || '0', 10);
	const minutes = parseInt(match[2] || '0', 10);
	const seconds = parseInt(match[3] || '0', 10);
	const secStr = seconds < 10 ? `0${seconds}` : `${seconds}`;
	if (hours > 0) {
		const minStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
		return `${hours}:${minStr}:${secStr}`;
	}
	return `${minutes}:${secStr}`;
}

export async function fetchOAuthPlaylistPage(id: string): Promise<PlaylistPage | null> {
	const session = getStoredOAuthSession();
	if (!session?.accessToken) return null;

	let cleanId = id.replace(/^VL/, '');
	const isLiked = cleanId === 'LM' || cleanId === 'LL' || cleanId === 'VLLM' || cleanId === 'FEmusic_liked_videos';

	try {
		if (isLiked) {
			const res = await fetch(
				'https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&myRating=like&maxResults=50',
				{ headers: { Authorization: `Bearer ${session.accessToken}` } }
			);

			if (!res.ok) {
				const errText = await res.text().catch(() => '');
				console.warn('Failed to fetch liked videos:', res.status, errText);
				return null;
			}

			const data = await res.json();
			const items: SongItem[] = (data.items || [])
				.map((item: any) => {
					const videoId = item.id;
					const songTitle = item.snippet?.title || 'Unknown Title';
					const artist = item.snippet?.channelTitle || 'Unknown Artist';
					const thumb =
						item.snippet?.thumbnails?.maxres?.url ||
						item.snippet?.thumbnails?.high?.url ||
						item.snippet?.thumbnails?.medium?.url ||
						item.snippet?.thumbnails?.default?.url;

					return {
						video_id: videoId,
						title: songTitle,
						artists: artist,
						artist_id: item.snippet?.channelId,
						thumbnail: thumb || (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : undefined),
						duration: parseIsoDuration(item.contentDetails?.duration),
						rating: 'LIKE' as const
					};
				})
				.filter((s: SongItem) => !!s.video_id && s.title !== 'Private video' && s.title !== 'Deleted video');

			return {
				title: 'Liked Music',
				description: 'Your liked songs and videos',
				subtitle: data.pageInfo?.totalResults ? `${data.pageInfo.totalResults} songs` : `${items.length} songs`,
				thumbnail: items[0]?.thumbnail,
				items,
				continuation: data.nextPageToken ? `oauth:liked:${data.nextPageToken}` : undefined,
				owned: true,
				collaborative: false
			};
		}

		// User playlist: fetch playlist details and playlistItems concurrently in parallel
		const [plInfoRes, itemsRes] = await Promise.all([
			fetch(
				`https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${encodeURIComponent(cleanId)}`,
				{ headers: { Authorization: `Bearer ${session.accessToken}` } }
			).catch(() => null),
			fetch(
				`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(cleanId)}&maxResults=50`,
				{ headers: { Authorization: `Bearer ${session.accessToken}` } }
			).catch(() => null)
		]);

		if (!itemsRes || !itemsRes.ok) return null;

		let title = 'Playlist';
		let description: string | undefined = undefined;
		if (plInfoRes && plInfoRes.ok) {
			const plInfoData = await plInfoRes.json().catch(() => null);
			if (plInfoData?.items?.[0]?.snippet?.title) {
				title = plInfoData.items[0].snippet.title;
				description = plInfoData.items[0].snippet.description;
			}
		}

		const data = await itemsRes.json();
		const items: SongItem[] = (data.items || [])
			.map((item: any) => {
				const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
				const songTitle = item.snippet?.title || 'Unknown Title';
				const artist = item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || 'Unknown Artist';
				const thumb =
					item.snippet?.thumbnails?.high?.url ||
					item.snippet?.thumbnails?.medium?.url ||
					item.snippet?.thumbnails?.default?.url;

				return {
					video_id: videoId,
					title: songTitle,
					artists: artist,
					artist_id: item.snippet?.videoOwnerChannelId,
					thumbnail: thumb || (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : undefined),
					duration: '3:00',
					rating: 'indifferent' as const
				};
			})
			.filter((s: SongItem) => !!s.video_id && s.title !== 'Private video' && s.title !== 'Deleted video');

		return {
			title,
			description,
			subtitle: `${items.length} songs`,
			thumbnail: items[0]?.thumbnail,
			items,
			continuation: data.nextPageToken ? `oauth:${cleanId}:${data.nextPageToken}` : undefined,
			owned: true,
			collaborative: false
		};
	} catch (e) {
		console.warn('fetchOAuthPlaylistPage failed:', e);
		return null;
	}
}

export async function fetchOAuthPlaylistContinuation(
	idOrLiked: string,
	pageToken: string
): Promise<PlaylistContinuation | null> {
	const session = getStoredOAuthSession();
	if (!session?.accessToken) return null;

	try {
		if (idOrLiked === 'liked') {
			const res = await fetch(
				`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&myRating=like&maxResults=50&pageToken=${encodeURIComponent(pageToken)}`,
				{ headers: { Authorization: `Bearer ${session.accessToken}` } }
			);
			if (!res.ok) return null;
			const data = await res.json();
			const items: SongItem[] = (data.items || [])
				.map((item: any) => {
					const videoId = item.id;
					const songTitle = item.snippet?.title || 'Unknown Title';
					const artist = item.snippet?.channelTitle || 'Unknown Artist';
					const thumb =
						item.snippet?.thumbnails?.maxres?.url ||
						item.snippet?.thumbnails?.high?.url ||
						item.snippet?.thumbnails?.medium?.url ||
						item.snippet?.thumbnails?.default?.url;

					return {
						video_id: videoId,
						title: songTitle,
						artists: artist,
						artist_id: item.snippet?.channelId,
						thumbnail: thumb || (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : undefined),
						duration: parseIsoDuration(item.contentDetails?.duration),
						rating: 'LIKE' as const
					};
				})
				.filter((s: SongItem) => !!s.video_id && s.title !== 'Private video' && s.title !== 'Deleted video');

			return {
				items,
				continuation: data.nextPageToken ? `oauth:liked:${data.nextPageToken}` : undefined
			};
		} else {
			const res = await fetch(
				`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(idOrLiked)}&maxResults=50&pageToken=${encodeURIComponent(pageToken)}`,
				{ headers: { Authorization: `Bearer ${session.accessToken}` } }
			);
			if (!res.ok) return null;
			const data = await res.json();
			const items: SongItem[] = (data.items || [])
				.map((item: any) => {
					const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
					const songTitle = item.snippet?.title || 'Unknown Title';
					const artist = item.snippet?.videoOwnerChannelTitle || item.snippet?.channelTitle || 'Unknown Artist';
					const thumb =
						item.snippet?.thumbnails?.high?.url ||
						item.snippet?.thumbnails?.medium?.url ||
						item.snippet?.thumbnails?.default?.url;

					return {
						video_id: videoId,
						title: songTitle,
						artists: artist,
						artist_id: item.snippet?.videoOwnerChannelId,
						thumbnail: thumb || (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : undefined),
						duration: '3:00',
						rating: 'indifferent' as const
					};
				})
				.filter((s: SongItem) => !!s.video_id && s.title !== 'Private video' && s.title !== 'Deleted video');

			return {
				items,
				continuation: data.nextPageToken ? `oauth:${idOrLiked}:${data.nextPageToken}` : undefined
			};
		}
	} catch (e) {
		console.warn('fetchOAuthPlaylistContinuation error:', e);
		return null;
	}
}
