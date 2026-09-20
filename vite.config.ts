import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const isGithubPages = process.env.GITHUB_PAGES?.trim() === 'true';

export default defineConfig({
	server: {
		port: 5183,
		strictPort: true,
		proxy: {
			'/api/ytm': {
				target: 'https://music.youtube.com/youtubei/v1',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api\/ytm/, ''),
				headers: {
					Origin: 'https://music.youtube.com',
					Referer: 'https://music.youtube.com/',
					'X-YouTube-Client-Name': '67',
					'X-YouTube-Client-Version': '1.20250101.01.00',
					'User-Agent':
						'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
				}
			}
		}
	},
	plugins: [
		{
			name: 'nocturne-dev-referrer-policy',
			configureServer(server) {
				server.middlewares.use((_req, res, next) => {
					res.setHeader('Referrer-Policy', 'no-referrer');
					next();
				});
			}
		},
		tailwindcss(),
		sveltekit({
			adapter: adapter({ fallback: 'index.html' }),
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			...(isGithubPages ? { paths: { base: '/nocturne-web' } } : {})
		})
	]
});
