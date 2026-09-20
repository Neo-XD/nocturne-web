import type {
	Account,
	AlbumPage,
	ArtistPage,
	BrowseItem,
	HomeChip,
	HomePage,
	HomeSection,
	PlaylistPage,
	SearchResults,
	SongItem
} from './api';
import { getStoredOAuthSession, fetchOAuthPlaylistPage } from './oauth';

const YTM_CLIENT_CONTEXT = {
	client: {
		clientName: 'WEB_REMIX',
		clientVersion: '1.20250101.01.00',
		hl: 'en',
		gl: 'US'
	}
};

const FILTER_SONG = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';

function getStoredCookie(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem('nocturne_ytm_cookie');
}

export function setStoredCookie(cookie: string | null): void {
	if (typeof localStorage === 'undefined') return;
	if (cookie) {
		localStorage.setItem('nocturne_ytm_cookie', cookie.trim());
	} else {
		localStorage.removeItem('nocturne_ytm_cookie');
	}
}

export function getApiBaseUrl(): string {
	if (typeof window === 'undefined') return '';
	if (window.location.hostname !== 'nocturne-web.amritanshu-praveen.workers.dev') {
		return 'https://nocturne-web.amritanshu-praveen.workers.dev';
	}
	return '';
}

async function postYtm(endpoint: string, body: Record<string, any>): Promise<any> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};
	const cookie = getStoredCookie();
	if (cookie) {
		headers['x-ytm-cookie'] = cookie;
	}
	const oauthSession = getStoredOAuthSession();
	if (oauthSession?.accessToken) {
		headers['Authorization'] = `Bearer ${oauthSession.accessToken}`;
	}

	const apiBase = getApiBaseUrl();
	const res = await fetch(`${apiBase}/api/ytm/${endpoint}`, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			context: YTM_CLIENT_CONTEXT,
			...body
		})
	});

	if (!res.ok) {
		throw new Error(`YTM request to ${endpoint} failed with status ${res.status}`);
	}
	return await res.json();
}

// ---------------------------------------------------------------------------
// Helpers for walking InnerTube JSON
// ---------------------------------------------------------------------------

function findAll(obj: any, key: string, results: any[] = []): any[] {
	if (!obj || typeof obj !== 'object') return results;
	if (Array.isArray(obj)) {
		for (const item of obj) findAll(item, key, results);
	} else {
		for (const k in obj) {
			if (k === key) results.push(obj[k]);
			findAll(obj[k], key, results);
		}
	}
	return results;
}

function getRunsText(obj: any): string {
	if (!obj) return '';
	if (obj.simpleText) return obj.simpleText;
	if (Array.isArray(obj.runs)) {
		return obj.runs.map((r: any) => r.text || '').join('');
	}
	return '';
}

function getThumbnail(thumbnailsObj: any): string | undefined {
	const list = thumbnailsObj?.thumbnails || (Array.isArray(thumbnailsObj) ? thumbnailsObj : null);
	if (Array.isArray(list) && list.length > 0) {
		return list[list.length - 1]?.url;
	}
	return undefined;
}

export function getMusicVideoType(renderer: any): string | undefined {
	if (!renderer) return undefined;
	const direct =
		renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ||
		renderer.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ||
		renderer.onTap?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ||
		renderer.doubleTap?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
	if (direct) return direct;

	const configs = findAll(renderer, 'watchEndpointMusicConfig');
	for (const c of configs) {
		if (c?.musicVideoType) return c.musicVideoType;
	}
	return undefined;
}

export function isAudioTrack(renderer: any, allowOmv = false): boolean {
	const mvt = getMusicVideoType(renderer);
	if (!mvt) return allowOmv;
	// Reject non-music content: user-generated YouTube videos, podcast episodes, etc.
	if (mvt === 'MUSIC_VIDEO_TYPE_UGC' || mvt === 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE') return false;
	if (mvt === 'MUSIC_VIDEO_TYPE_OMV') return allowOmv;
	return mvt === 'MUSIC_VIDEO_TYPE_ATV' || mvt === 'MUSIC_VIDEO_TYPE_PRIVATELY_OWNED_TRACK';
}

function parseSongRow(renderer: any, allowOmv = false): SongItem | null {
	if (!renderer) return null;
	if (!isAudioTrack(renderer, allowOmv)) return null;

	const videoId =
		renderer.playlistItemData?.videoId ||
		renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
		renderer.onTap?.watchEndpoint?.videoId ||
		renderer.doubleTap?.watchEndpoint?.videoId;

	if (!videoId) return null;

	const flexCols = renderer.flexColumns || [];
	const titleCol = flexCols[0]?.musicResponsiveListItemFlexColumnRenderer?.text;
	const title = getRunsText(titleCol);
	if (!title) return null;

	const subtitleCol = flexCols[1]?.musicResponsiveListItemFlexColumnRenderer?.text;
	const subtitleRuns: any[] = subtitleCol?.runs || [];

	// Subtitle format: "Artist • Album • 3:45" or "Artist • 3:45"
	let artists = '';
	let album: string | undefined = undefined;
	let duration: string | undefined = undefined;
	let artistId: string | undefined = undefined;

	const parts: string[][] = [[]];
	for (const r of subtitleRuns) {
		if (r.text?.trim() === '•') {
			parts.push([]);
		} else {
			parts[parts.length - 1].push(r.text || '');
			if (!artistId && r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC')) {
				artistId = r.navigationEndpoint.browseEndpoint.browseId;
			}
		}
	}

	if (parts.length > 0) artists = parts[0].join('');
	if (parts.length === 2) {
		const second = parts[1].join('');
		if (second.match(/^\d+:\d+$/)) duration = second;
		else album = second;
	} else if (parts.length >= 3) {
		album = parts[1].join('');
		duration = parts[2].join('');
	}

	// Fixed columns fallback for duration / album
	const fixedCols = renderer.fixedColumns || [];
	if (!duration && fixedCols.length > 0) {
		duration = getRunsText(fixedCols[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
	}

	const thumb = getThumbnail(renderer.thumbnail?.musicThumbnailRenderer?.thumbnail);

	return {
		video_id: videoId,
		title,
		artists: artists || 'Unknown Artist',
		artist_id: artistId,
		album,
		duration: duration || '3:00',
		thumbnail: thumb || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
		rating: 'indifferent'
	};
}

function parseTwoRowItem(renderer: any): BrowseItem | null {
	if (!renderer) return null;

	const title = getRunsText(renderer.title);
	const subtitle = getRunsText(renderer.subtitle);
	const thumb = getThumbnail(renderer.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail);

	const nav =
		renderer.navigationEndpoint?.browseEndpoint ||
		renderer.navigationEndpoint?.watchEndpoint ||
		renderer.onTap?.browseEndpoint ||
		renderer.onTap?.watchEndpoint;

	let kind: 'song' | 'playlist' | 'album' | 'artist' = 'playlist';
	let id = '';

	if (nav?.videoId) {
		if (!isAudioTrack(renderer)) return null;
		kind = 'song';
		id = nav.videoId;
	} else if (nav?.browseId) {
		id = nav.browseId;
		if (id.startsWith('MPRE') || id.startsWith('FEmusic_library_privately_owned_release')) {
			kind = 'album';
		} else if (id.startsWith('UC')) {
			kind = 'artist';
		} else {
			kind = 'playlist';
		}
	} else if (renderer.playlistItemData?.videoId) {
		if (!isAudioTrack(renderer)) return null;
		kind = 'song';
		id = renderer.playlistItemData.videoId;
	}

	if (!id) return null;

	return {
		kind,
		id,
		title: title || 'Untitled',
		subtitle,
		thumbnail: thumb
	};
}

// ---------------------------------------------------------------------------
// Exported API Functions
// ---------------------------------------------------------------------------

export async function ytmSearchSongs(query: string): Promise<SongItem[]> {
	try {
		const data = await postYtm('search', { query, params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA==' });
		const listRenderers = findAll(data, 'musicResponsiveListItemRenderer');
		const songs: SongItem[] = [];
		for (const r of listRenderers) {
			const s = parseSongRow(r, false);
			if (s) songs.push(s);
		}
		if (songs.length > 0) return songs;
	} catch (e) {
		console.warn('ytmSearchSongs error:', e);
	}
	return [];
}

export async function ytmSearchAll(query: string): Promise<SearchResults> {
	const results: SearchResults = {
		top: [],
		songs: [],
		albums: [],
		artists: [],
		playlists: []
	};

	try {
		const [searchData, songResults, featuredPlaylists] = await Promise.all([
			postYtm('search', { query }).catch(() => null),
			ytmSearchSongs(query).catch(() => [] as SongItem[]),
			ytmSearchCards(query, 'playlists').catch(() => [] as BrowseItem[])
		]);

		// 1. Songs: strictly populated with ATV songs with square album covers
		if (songResults.length > 0) {
			results.songs = songResults.map((s) => ({
				kind: 'song',
				id: s.video_id,
				title: s.title,
				subtitle: s.artists,
				thumbnail: s.thumbnail,
				duration: s.duration
			}));
		}

		if (searchData) {
			// Card shelf: Top result (only if artist or album)
			const cardShelves = findAll(searchData, 'musicCardShelfRenderer');
			for (const card of cardShelves) {
				const title = getRunsText(card.title);
				const subtitle = getRunsText(card.subtitle);
				const thumb = getThumbnail(card.thumbnail?.musicThumbnailRenderer?.thumbnail);
				const browseId =
					card.onTap?.browseEndpoint?.browseId ||
					card.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;

				if (browseId && browseId.startsWith('UC')) {
					results.top.push({
						kind: 'artist',
						id: browseId,
						title: title || 'Top Artist',
						subtitle,
						thumbnail: thumb
					});
				} else if (
					browseId &&
					(browseId.startsWith('MPRE') ||
						browseId.startsWith('FEmusic_library_privately_owned_release'))
				) {
					results.top.push({
						kind: 'album',
						id: browseId,
						title: title || 'Top Album',
						subtitle,
						thumbnail: thumb
					});
				}
			}

			// Categorized responsive list items for albums & artists
			const items = findAll(searchData, 'musicResponsiveListItemRenderer');
			for (const item of items) {
				const flexCols = item.flexColumns || [];
				const titleCol = flexCols[0]?.musicResponsiveListItemFlexColumnRenderer?.text;
				const title = getRunsText(titleCol);
				if (!title) continue;

				const subtitleCol = flexCols[1]?.musicResponsiveListItemFlexColumnRenderer?.text;
				const subtitle = getRunsText(subtitleCol);
				const thumb = getThumbnail(item.thumbnail?.musicThumbnailRenderer?.thumbnail);

				const browseId =
					item.navigationEndpoint?.browseEndpoint?.browseId ||
					titleCol?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;

				if (browseId) {
					if (
						browseId.startsWith('MPRE') ||
						browseId.startsWith('FEmusic_library_privately_owned_release')
					) {
						if (!results.albums.some((a) => a.id === browseId)) {
							results.albums.push({
								kind: 'album',
								id: browseId,
								title,
								subtitle,
								thumbnail: thumb
							});
						}
						continue;
					}
					if (browseId.startsWith('UC')) {
						if (!results.artists.some((a) => a.id === browseId)) {
							results.artists.push({
								kind: 'artist',
								id: browseId,
								title,
								subtitle,
								thumbnail: thumb
							});
						}
						continue;
					}
				}
			}
		}

		// 2. Playlists: strictly official Featured Playlists without video clips
		if (featuredPlaylists.length > 0) {
			results.playlists = featuredPlaylists.filter((p) => !p.thumbnail?.includes('i.ytimg.com'));
		}

		// 3. Top result: if no artist or album was selected as top result, use top ATV song!
		if (results.top.length === 0 && results.songs.length > 0) {
			const topSong = results.songs[0];
			results.top.push({
				kind: 'song',
				id: topSong.id,
				title: topSong.title,
				subtitle: topSong.subtitle,
				thumbnail: topSong.thumbnail
			});
		}

		return results;
	} catch (e) {
		console.warn('ytmSearchAll error:', e);
		return results;
	}
}

export async function ytmGetHome(params?: string): Promise<HomePage> {
	try {
		const data = await postYtm('browse', {
			browseId: 'FEmusic_home',
			params: params || undefined
		});

		// Mood chips
		const chips: HomeChip[] = [];
		const chipNodes = findAll(data, 'chipCloudChipRenderer');
		for (const c of chipNodes) {
			const title = getRunsText(c.text);
			const p = c.navigationEndpoint?.browseEndpoint?.params;
			if (title && p) chips.push({ title, params: p });
		}

		// Carousels
		const sections: HomeSection[] = [];
		const carouselNodes = findAll(data, 'musicCarouselShelfRenderer');
		for (const shelf of carouselNodes) {
			const header = findAll(shelf, 'musicCarouselShelfBasicHeaderRenderer')[0];
			const title = getRunsText(header?.title) || 'Featured';

			const items: BrowseItem[] = [];
			const twoRowItems = findAll(shelf, 'musicTwoRowItemRenderer');
			for (const r of twoRowItems) {
				const card = parseTwoRowItem(r);
				if (card) items.push(card);
			}

			// Also check responsive list items in the shelf (e.g. quick picks)
			if (!items.length) {
				const listItems = findAll(shelf, 'musicResponsiveListItemRenderer');
				for (const li of listItems) {
					const s = parseSongRow(li);
					if (s) {
						items.push({
							kind: 'song',
							id: s.video_id,
							title: s.title,
							subtitle: s.artists,
							thumbnail: s.thumbnail,
							duration: s.duration
						});
					}
				}
			}

			if (items.length > 0) {
				sections.push({ title, items });
			}
		}

		return { chips, sections };
	} catch (e) {
		console.warn('ytmGetHome error:', e);
		return { chips: [], sections: [] };
	}
}

export async function ytmGetAccount(): Promise<Account> {
	const cookie = getStoredCookie();
	if (!cookie) return { signedIn: false };

	try {
		const data = await postYtm('account/account_menu', {});
		const header = findAll(data, 'activeAccountHeaderRenderer')[0];
		if (!header) return { signedIn: true };

		const name = getRunsText(header.accountName);
		const handle = getRunsText(header.channelHandle);
		const email = getRunsText(header.email);
		const thumbnail = getThumbnail(header.thumbnail);

		return {
			signedIn: true,
			name: name || undefined,
			handle: handle || undefined,
			email: email || undefined,
			thumbnail: thumbnail || undefined
		};
	} catch {
		return { signedIn: false };
	}
}

export async function ytmGetPlaylist(id: string): Promise<PlaylistPage> {
	try {
		let browseId = id;
		if (id === 'LM') {
			browseId = 'VLLM';
		} else if (!id.startsWith('VL') && !id.startsWith('FE') && !id.startsWith('MPRE')) {
			browseId = `VL${id}`;
		}
		const data = await postYtm('browse', { browseId });

		const header =
			findAll(data, 'musicDetailHeaderRenderer')[0] ||
			findAll(data, 'musicResponsiveHeaderRenderer')[0] ||
			findAll(data, 'musicEditablePlaylistDetailHeaderRenderer')[0];

		const title = getRunsText(header?.title) || 'Playlist';
		const subtitle = getRunsText(header?.subtitle) || '';
		const thumbnail = getThumbnail(header?.thumbnail);

		const items: SongItem[] = [];
		const listItems = findAll(data, 'musicResponsiveListItemRenderer');
		for (const li of listItems) {
			const s = parseSongRow(li, true);
			if (s) items.push(s);
		}

		if (items.length > 0) {
			return {
				title,
				subtitle,
				thumbnail,
				items,
				owned: false,
				collaborative: false
			};
		}
	} catch (e) {
		console.warn('ytmGetPlaylist InnerTube error:', e);
	}

	// Fallback to Google OAuth YouTube Data API if authenticated
	try {
		const oauthPage = await fetchOAuthPlaylistPage(id);
		if (oauthPage && oauthPage.items.length > 0) {
			return oauthPage;
		}
	} catch (e) {
		console.warn('ytmGetPlaylist OAuth fallback error:', e);
	}

	return { title: 'Playlist', items: [], owned: false, collaborative: false };
}

export async function ytmGetAlbum(id: string): Promise<AlbumPage> {
	try {
		const data = await postYtm('browse', { browseId: id });
		const header =
			findAll(data, 'musicDetailHeaderRenderer')[0] ||
			findAll(data, 'musicResponsiveHeaderRenderer')[0];

		const title = getRunsText(header?.title) || 'Album';
		const subtitle = getRunsText(header?.subtitle) || '';
		const thumbnail = getThumbnail(header?.thumbnail);

		const items: SongItem[] = [];
		const listItems = findAll(data, 'musicResponsiveListItemRenderer');
		for (const li of listItems) {
			const s = parseSongRow(li);
			if (s) items.push(s);
		}

		return {
			title,
			subtitle,
			thumbnail,
			items,
			inLibrary: false
		};
	} catch (e) {
		console.warn('ytmGetAlbum error:', e);
		return { title: 'Album', items: [], inLibrary: false };
	}
}

export async function ytmGetArtist(id: string): Promise<ArtistPage> {
	try {
		const data = await postYtm('browse', { browseId: id });
		const header =
			findAll(data, 'musicImmersiveHeaderRenderer')[0] ||
			findAll(data, 'musicVisualHeaderRenderer')[0];

		const name = getRunsText(header?.title) || 'Artist';
		const thumbnail = getThumbnail(header?.thumbnail);
		const description = getRunsText(header?.description);

		const topSongs: SongItem[] = [];
		const listItems = findAll(data, 'musicResponsiveListItemRenderer').slice(0, 10);
		for (const li of listItems) {
			const s = parseSongRow(li);
			if (s) topSongs.push(s);
		}

		return {
			name,
			channelId: id,
			thumbnail,
			description,
			subscribed: false,
			topSongs,
			sections: []
		};
	} catch (e) {
		console.warn('ytmGetArtist error:', e);
		return { name: 'Artist', channelId: id, subscribed: false, topSongs: [], sections: [] };
	}
}

export async function ytmGetLibraryPlaylists(): Promise<BrowseItem[]> {
	try {
		const data = await postYtm('browse', { browseId: 'FEmusic_liked_playlists' });
		const twoRowItems = findAll(data, 'musicTwoRowItemRenderer');
		const items: BrowseItem[] = [];
		for (const r of twoRowItems) {
			const item = parseTwoRowItem(r);
			if (item) items.push(item);
		}
		return items;
	} catch (e) {
		console.warn('ytmGetLibraryPlaylists error:', e);
		return [];
	}
}

export async function ytmGetLibraryAlbums(): Promise<BrowseItem[]> {
	try {
		const data = await postYtm('browse', { browseId: 'FEmusic_liked_albums' });
		const twoRowItems = findAll(data, 'musicTwoRowItemRenderer');
		const items: BrowseItem[] = [];
		for (const r of twoRowItems) {
			const item = parseTwoRowItem(r);
			if (item) {
				item.kind = 'album';
				items.push(item);
			}
		}
		return items;
	} catch (e) {
		console.warn('ytmGetLibraryAlbums error:', e);
		return [];
	}
}

export async function ytmGetLibraryArtists(): Promise<BrowseItem[]> {
	try {
		const data = await postYtm('browse', { browseId: 'FEmusic_library_corpus_track_artists' });
		const twoRowItems = findAll(data, 'musicTwoRowItemRenderer');
		const items: BrowseItem[] = [];
		for (const r of twoRowItems) {
			const item = parseTwoRowItem(r);
			if (item) {
				item.kind = 'artist';
				items.push(item);
			}
		}
		if (!items.length) {
			const listItems = findAll(data, 'musicResponsiveListItemRenderer');
			for (const r of listItems) {
				const item = parseTwoRowItem(r);
				if (item) {
					item.kind = 'artist';
					items.push(item);
				}
			}
		}
		return items;
	} catch (e) {
		console.warn('ytmGetLibraryArtists error:', e);
		return [];
	}
}

export async function ytmGetSongRadio(videoId: string): Promise<SongItem[]> {
	try {
		const data = await postYtm('next', {
			videoId,
			playlistId: `RDAMVM${videoId}`,
			isAudioOnly: true
		});
		const allRenderers = findAll(data, 'playlistPanelVideoRenderer');
		const items: SongItem[] = [];
		for (const r of allRenderers) {
			if (!r.videoId) continue;
			const title = r.title?.runs?.map((x: any) => x.text).join('') || 'Unknown Title';
			const artists = r.shortBylineText?.runs?.map((x: any) => x.text).join('') || 'Unknown Artist';
			const duration = r.lengthText?.runs?.map((x: any) => x.text).join('') || '3:00';
			const thumb = r.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`;
			items.push({
				video_id: r.videoId,
				title,
				artists,
				duration,
				thumbnail: thumb,
				rating: 'indifferent',
				autoplay: true
			});
		}
		return items;
	} catch (e) {
		console.warn('ytmGetSongRadio error:', e);
		return [];
	}
}

export async function ytmSearchCards(query: string, category: string): Promise<BrowseItem[]> {
	let params: string | undefined = undefined;
	if (category === 'albums') params = 'EgWKAQIYAWoKEAkQChAFEAMQBA==';
	else if (category === 'artists') params = 'EgWKAQIgAWoKEAkQChAFEAMQBA==';
	else if (category === 'playlists') params = 'EgeKAQQoADgBahIQBBADEAkQBRAKEBAQDhAVEBE=';

	if (!params) return [];

	try {
		const data = await postYtm('search', { query, params });
		const list = findAll(data, 'musicResponsiveListItemRenderer');
		const items: BrowseItem[] = [];
		for (const r of list) {
			const item = parseTwoRowItem(r);
			if (item) {
				if (category === 'albums') item.kind = 'album';
				else if (category === 'artists') item.kind = 'artist';
				else if (category === 'playlists') item.kind = 'playlist';
				items.push(item);
			}
		}
		if (!items.length) {
			const twoRow = findAll(data, 'musicTwoRowItemRenderer');
			for (const r of twoRow) {
				const item = parseTwoRowItem(r);
				if (item) {
					if (category === 'albums') item.kind = 'album';
					else if (category === 'artists') item.kind = 'artist';
					else if (category === 'playlists') item.kind = 'playlist';
					items.push(item);
				}
			}
		}
		return items;
	} catch (e) {
		console.warn('ytmSearchCards error:', e);
		return [];
	}
}



