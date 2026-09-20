<script lang="ts">
	import { page } from '$app/state';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Home01Icon,
		LibraryIcon,
		Search01Icon
	} from '@hugeicons/core-free-icons';

	const isHome = $derived(page.url.pathname === '/');
	const isLibrary = $derived(
		page.url.pathname.startsWith('/library') ||
		page.url.pathname.startsWith('/playlist') ||
		page.url.pathname.startsWith('/album') ||
		page.url.pathname.startsWith('/artist')
	);
	const isSearch = $derived(page.url.pathname.startsWith('/search'));
</script>

<nav
	class="fixed bottom-0 left-0 right-0 z-40 flex h-14 md:hidden items-center justify-around border-t border-border/70 bg-background/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
	aria-label="Mobile Navigation"
>
	<!-- Home (Move to the left) -->
	<a
		href="/"
		class="flex flex-1 flex-col items-center justify-center gap-0.5 py-1 transition-colors select-none {isHome
			? 'text-primary font-semibold'
			: 'text-muted-foreground hover:text-foreground'}"
		aria-label="Home"
	>
		<HugeiconsIcon icon={Home01Icon} class="h-5 w-5 {isHome ? 'stroke-[2.5]' : 'stroke-2'}" />
		<span class="text-[10px] tracking-tight">Home</span>
	</a>

	<!-- Library (Center) -->
	<a
		href="/library"
		class="flex flex-1 flex-col items-center justify-center gap-0.5 py-1 transition-colors select-none {isLibrary
			? 'text-primary font-semibold'
			: 'text-muted-foreground hover:text-foreground'}"
		aria-label="Library"
	>
		<HugeiconsIcon icon={LibraryIcon} class="h-5 w-5 {isLibrary ? 'stroke-[2.5]' : 'stroke-2'}" />
		<span class="text-[10px] tracking-tight">Library</span>
	</a>

	<!-- Search (Right) -->
	<a
		href="/search"
		class="flex flex-1 flex-col items-center justify-center gap-0.5 py-1 transition-colors select-none {isSearch
			? 'text-primary font-semibold'
			: 'text-muted-foreground hover:text-foreground'}"
		aria-label="Search"
	>
		<HugeiconsIcon icon={Search01Icon} class="h-5 w-5 {isSearch ? 'stroke-[2.5]' : 'stroke-2'}" />
		<span class="text-[10px] tracking-tight">Search</span>
	</a>
</nav>
