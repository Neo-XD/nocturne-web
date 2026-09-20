async function getSapisidHash(sapisid: string, origin = 'https://music.youtube.com'): Promise<string> {
	const epoch = Math.floor(Date.now() / 1000);
	const data = new TextEncoder().encode(`${epoch} ${sapisid} ${origin}`);
	const hashBuffer = await crypto.subtle.digest('SHA-1', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	return `SAPISIDHASH ${epoch}_${hashHex}`;
}

function extractSapisid(cookie: string): string | null {
	const parts = cookie.split(';');
	for (const part of parts) {
		const [k, v] = part.split('=').map((s) => s.trim());
		if (k === 'SAPISID' || k === '__Secure-3PAPISID') {
			return v || null;
		}
	}
	return null;
}

function createTimeoutSignal(ms: number): AbortSignal | undefined {
	if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
		return AbortSignal.timeout(ms);
	}
	const controller = new AbortController();
	setTimeout(() => controller.abort(), ms);
	return controller.signal;
}

async function resolveAudioStream(videoId: string): Promise<string | null> {
	// 1. Try Invidious instances that resolve direct googlevideo audio streams
	const invidiousInstances = [
		'https://invidious.f5.si'
	];

	for (const inst of invidiousInstances) {
		try {
			const signal = createTimeoutSignal(4000);
			const invResp = await fetch(`${inst}/api/v1/videos/${encodeURIComponent(videoId)}`, {
				headers: { Accept: 'application/json' },
				signal
			});
			if (invResp.ok) {
				const data: any = await invResp.json();
				const formats = data.adaptiveFormats;
				if (Array.isArray(formats)) {
					const audioFormats = formats.filter(
						(f: any) => (f.type?.startsWith('audio/') || f.mimeType?.startsWith('audio/')) && f.url
					);
					if (audioFormats.length) {
						const mp4a = audioFormats.find((f: any) => (f.type || f.mimeType || '').includes('audio/mp4'));
						return mp4a?.url || audioFormats[0].url;
					}
				}
			}
		} catch {
			// Continue to next instance
		}
	}

	// 2. Fallback to InnerTube ANDROID_VR client
	try {
		const playerPayload = {
			context: {
				client: {
					clientName: 'ANDROID_VR',
					clientVersion: '1.43.32',
					deviceMake: 'Oculus',
					deviceModel: 'Quest 3',
					osName: 'Android',
					osVersion: '12',
					hl: 'en',
					gl: 'US'
				}
			},
			videoId,
			contentCheckOk: true,
			racyCheckOk: true
		};

		const resp = await fetch('https://www.youtube.com/youtubei/v1/player', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent':
					'com.google.android.apps.youtube.vr.oculus/1.43.32 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/107.0.5284.2)'
			},
			body: JSON.stringify(playerPayload)
		});

		if (!resp.ok) return null;
		const data: any = await resp.json();
		const formats = data.streamingData?.adaptiveFormats;
		if (!Array.isArray(formats)) return null;

		const audioFormats = formats.filter(
			(f: any) => f.mimeType?.startsWith('audio/') && f.url
		);
		if (!audioFormats.length) return null;

		const mp4a = audioFormats.find((f: any) => f.mimeType?.includes('audio/mp4'));
		return mp4a?.url || audioFormats[0].url;
	} catch {
		return null;
	}
}

export default {
	async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
		try {
			const url = new URL(request.url);

			// Handle CORS preflight
			if (request.method === 'OPTIONS') {
				return new Response(null, {
					headers: {
						'Access-Control-Allow-Origin': '*',
						'Access-Control-Allow-Headers': '*',
						'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
					}
				});
			}

			// Audio streaming proxy
			if (url.pathname === '/api/stream') {
				const videoId = url.searchParams.get('id');
				if (!videoId) return new Response('Missing id', { status: 400 });

				const audioUrl = await resolveAudioStream(videoId);
				if (!audioUrl) return new Response('Audio stream not found', { status: 404 });

				const forwardHeaders = new Headers();
				const range = request.headers.get('range');
				if (range) {
					forwardHeaders.set('Range', range);
				}

				try {
					const streamResp = await fetch(audioUrl, {
						headers: forwardHeaders
					});

					const respHeaders = new Headers();
					respHeaders.set('Access-Control-Allow-Origin', '*');
					respHeaders.set('Access-Control-Allow-Headers', '*');
					respHeaders.set('Accept-Ranges', 'bytes');
					if (streamResp.headers.has('Content-Type')) {
						respHeaders.set('Content-Type', streamResp.headers.get('Content-Type')!);
					} else {
						respHeaders.set('Content-Type', 'audio/mp4');
					}
					if (streamResp.headers.has('Content-Length')) {
						respHeaders.set('Content-Length', streamResp.headers.get('Content-Length')!);
					}
					if (streamResp.headers.has('Content-Range')) {
						respHeaders.set('Content-Range', streamResp.headers.get('Content-Range')!);
					}

					if (url.searchParams.get('download') === '1') {
						const title = url.searchParams.get('title') || 'track';
						const cleanTitle = title.replace(/[^a-zA-Z0-9_\-\. ]/g, '_');
						respHeaders.set('Content-Disposition', `attachment; filename="${cleanTitle}.m4a"`);
					}

					return new Response(streamResp.body, {
						status: streamResp.status,
						statusText: streamResp.statusText,
						headers: respHeaders
					});
				} catch (err: any) {
					return new Response(`Stream fetch failed: ${err?.message || err}`, { status: 502 });
				}
			}

			// Proxy YouTube Music InnerTube requests
			if (url.pathname.startsWith('/api/ytm/')) {
				const subpath = url.pathname.replace(/^\/api\/ytm\//, '');
				const targetUrl = `https://music.youtube.com/youtubei/v1/${subpath}${url.search}`;

				const headers = new Headers();
				headers.set('Content-Type', 'application/json');
				headers.set('Origin', 'https://music.youtube.com');
				headers.set('Referer', 'https://music.youtube.com/');
				headers.set('X-YouTube-Client-Name', '67');
				headers.set('X-YouTube-Client-Version', '1.20250101.01.00');
				headers.set(
					'User-Agent',
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
				);

				// Forward cookie and SAPISIDHASH auth if present
				const authCookie = request.headers.get('x-ytm-cookie');
				if (authCookie) {
					headers.set('Cookie', authCookie);
					const sapisid = extractSapisid(authCookie);
					if (sapisid) {
						try {
							const authHeader = await getSapisidHash(sapisid);
							headers.set('Authorization', authHeader);
						} catch (e) {
							console.warn('Failed to compute SAPISIDHASH:', e);
						}
					}
				}

				const init: RequestInit = {
					method: request.method,
					headers,
					body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined
				};

				try {
					const resp = await fetch(targetUrl, init);
					const respHeaders = new Headers(resp.headers);
					respHeaders.set('Access-Control-Allow-Origin', '*');
					respHeaders.set('Access-Control-Allow-Headers', '*');
					respHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

					return new Response(resp.body, {
						status: resp.status,
						statusText: resp.statusText,
						headers: respHeaders
					});
				} catch (proxyErr: any) {
					return new Response(JSON.stringify({ error: proxyErr?.message || 'Upstream YTM fetch failed' }), {
						status: 502,
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*'
						}
					});
				}
			}

			// Serve static assets with SPA routing fallback (rewrite 404 navigation to /index.html)
			let assetResp = await env.ASSETS.fetch(request);
			if (assetResp.status === 404 && !url.pathname.includes('.')) {
				const indexUrl = new URL('/index.html', request.url);
				assetResp = await env.ASSETS.fetch(new Request(indexUrl, request));
			}
			return assetResp;
		} catch (topErr: any) {
			console.error('Unhandled worker exception:', topErr);
			return new Response(`Worker internal error: ${topErr?.message || topErr}`, {
				status: 500,
				headers: { 'Content-Type': 'text/plain' }
			});
		}
	}
};
