import type { Account, BrowseItem } from './api';
import { emitWebEvent } from './webEngine';

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

export async function fetchOAuthUserPlaylists(): Promise<BrowseItem[]> {
	const session = getStoredOAuthSession();
	if (!session?.accessToken) return [];

	try {
		const res = await fetch(
			'https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50',
			{ headers: { Authorization: `Bearer ${session.accessToken}` } }
		);

		if (!res.ok) {
			if (res.status === 401) {
				clearOAuthSession();
			}
			return [];
		}

		const data = await res.json();
		const items: BrowseItem[] = (data.items || []).map((p: any) => ({
			kind: 'playlist' as const,
			id: p.id,
			title: p.snippet?.title || 'Untitled Playlist',
			subtitle: `${p.contentDetails?.itemCount || 0} tracks`,
			thumbnail:
				p.snippet?.thumbnails?.high?.url ||
				p.snippet?.thumbnails?.medium?.url ||
				p.snippet?.thumbnails?.default?.url
		}));

		// Prepend Liked Music
		items.unshift({
			kind: 'playlist',
			id: 'VLLM',
			title: 'Liked Music',
			subtitle: 'Auto playlist'
		});

		return items;
	} catch (e) {
		console.warn('Failed to fetch OAuth user playlists:', e);
		return [];
	}
}
