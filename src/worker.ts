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

export default {
	async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
		const url = new URL(request.url);

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
		}

		// Handle preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Headers': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
				}
			});
		}

		// Serve static assets
		return env.ASSETS.fetch(request);
	}
};
