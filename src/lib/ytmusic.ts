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

async function postYtm(endpoint: string, body: Record<string, any>): Promise<any> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};
	const cookie = getStoredCookie();
	if (cookie) {
		headers['x-ytm-cookie'] = cookie;
	}

	const res = await fetch(`/api/ytm/${endpoint}`, {
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
		for (const k of Object.keys(obj)) {
			if (k === key) results.push(obj[k]);
			findAll(obj[k], key, results);
		}
	}
	return results;
}

function getRunsText(runsObj: any): string {
	if (!runsObj) return '';
	if (typeof runsObj === 'string') return runsObj;
	if (Array.isArray(runsObj.runs)) {
		return runsObj.runs.map((r: any) => r?.text || '').join('');
	}
	if (runsObj.simpleText) return runsObj.simpleText;
	return '';
}

function getThumbnail(thumbnailsObj: any): string | undefined {
	if (!thumbnailsObj) return undefined;
	const thumbs = thumbnailsObj.thumbnails || thumbnailsObj.sources || thumbnailsObj;
	if (Array.isArray(thumbs) && thumbs.length > 0) {
		return thumbs[thumbs.length - 1]?.url;
	}
	return undefined;
}

function parseSongRow(renderer: any): SongItem | null {
	if (!renderer) return null;

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
		const data = await postYtm('search', { query, params: FILTER_SONG });
		const listRenderers = findAll(data, 'musicResponsiveListItemRenderer');
		const songs: SongItem[] = [];
		for (const r of listRenderers) {
			const s = parseSongRow(r);
			if (s) songs.push(s);
		}
		return songs;
	} catch (e) {
		console.warn('ytmSearchSongs error:', e);
		return [];
	}
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
		const data = await postYtm('search', { query });
		// Card shelf: Top result
		const cardShelves = findAll(data, 'musicCardShelfRenderer');
		for (const card of cardShelves) {
			const title = getRunsText(card.title);
			const subtitle = getRunsText(card.subtitle);
			const thumb = getThumbnail(card.thumbnail?.musicThumbnailRenderer?.thumbnail);
			const browseId = card.onTap?.browseEndpoint?.browseId;
			const videoId = card.onTap?.watchEndpoint?.videoId;

			if (browseId || videoId) {
				results.top.push({
					kind: videoId ? 'song' : browseId.startsWith('UC') ? 'artist' : 'album',
					id: videoId || browseId,
					title,
					subtitle,
					thumbnail: thumb
				});
			}
		}

		// Responsive list items categorized
		const items = findAll(data, 'musicResponsiveListItemRenderer');
		for (const item of items) {
			const song = parseSongRow(item);
			if (!song) continue;

			// Check navigation to see if it's album, artist, playlist, or song
			const browseId =
				item.navigationEndpoint?.browseEndpoint?.browseId ||
				item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;

			if (browseId?.startsWith('MPRE')) {
				results.albums.push({
					kind: 'album',
					id: browseId,
					title: song.title,
					subtitle: song.artists,
					thumbnail: song.thumbnail
				});
			} else if (browseId?.startsWith('UC')) {
				results.artists.push({
					kind: 'artist',
					id: browseId,
					title: song.title,
					subtitle: song.artists,
					thumbnail: song.thumbnail
				});
			} else if (browseId?.startsWith('VL')) {
				results.playlists.push({
					kind: 'playlist',
					id: browseId,
					title: song.title,
					subtitle: song.artists,
					thumbnail: song.thumbnail
				});
			} else {
				results.songs.push({
					kind: 'song',
					id: song.video_id,
					title: song.title,
					subtitle: song.artists,
					thumbnail: song.thumbnail,
					duration: song.duration
				});
			}
		}
	} catch (e) {
		console.warn('ytmSearchAll error:', e);
	}

	return results;
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
		const browseId = id.startsWith('VL') ? id : `VL${id}`;
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
			const s = parseSongRow(li);
			if (s) items.push(s);
		}

		return {
			title,
			subtitle,
			thumbnail,
			items,
			owned: false,
			collaborative: false
		};
	} catch (e) {
		console.warn('ytmGetPlaylist error:', e);
		return { title: 'Playlist', items: [], owned: false, collaborative: false };
	}
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
