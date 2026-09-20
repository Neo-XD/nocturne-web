<script lang="ts">
	import { fly, fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		ArrowDown01Icon,
		PreviousIcon,
		NextIcon,
		PlayIcon,
		PauseIcon,
		ShuffleIcon,
		RepeatIcon,
		RepeatOne01Icon,
		FavouriteIcon,
		Add01Icon,
		Mic01Icon,
		Queue01Icon,
		MusicNote01Icon,
		Download01Icon
	} from '@hugeicons/core-free-icons';
	import * as api from '$lib/api';
	import {
		np,
		playback,
		cycleRepeat,
		openAddToPlaylist,
		toggleNowPlayingLike,
		toast
	} from '$lib/player.svelte';
	import { appearance } from '$lib/theme.svelte';
	import { thumb } from '$lib/thumb';
	import QueueList from './QueueList.svelte';
	import LyricsView from './LyricsView.svelte';

	let tab = $state<'cover' | 'lyrics' | 'queue'>('cover');
	let justLiked = $state(false);
	let downloading = $state(false);

	function toggleLike() {
		if (playback.rating !== 'like') justLiked = true;
		toggleNowPlayingLike();
	}

	async function handleDownload() {
		const now = playback.now;
		if (!now?.videoId) return;
		downloading = true;
		try {
			toast.info(`Downloading "${now.title || 'song'}"...`);
			await api.downloadSong({
				videoId: now.videoId,
				title: now.title || 'track',
				artist: now.artists || 'Unknown Artist'
			});
			toast.success('Download started');
		} catch (e) {
			console.warn('Download error:', e);
			toast.error('Download failed');
		} finally {
			setTimeout(() => {
				downloading = false;
			}, 2000);
		}
	}

	const fmt = (secs: number) => {
		if (!secs || secs < 0) return '0:00';
		const t = Math.floor(secs);
		const m = Math.floor(t / 60);
		const s = t % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	};

	let seekDrag = $state<number | null>(null);
	const shownPosition = $derived(seekDrag ?? playback.position);

	function onSeekInput(e: Event) {
		seekDrag = Number((e.target as HTMLInputElement).value);
	}
	function onSeekCommit(e: Event) {
		const v = Number((e.target as HTMLInputElement).value);
		playback.position = v;
		api.seek(v);
		seekDrag = null;
	}

	const shuffleOn = $derived(playback.queue.shuffle ?? false);
	const repeat = $derived(playback.queue.repeat ?? 'off');

	let flash: 'play' | 'pause' | null = $state(null);
	let flashTimer: ReturnType<typeof setTimeout>;
	function togglePlay() {
		flash = playback.paused ? 'play' : 'pause';
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flash = null), 220);
		api.togglePause();
	}

	const currentSong = $derived.by(() => {
		const cur = playback.queue.items[playback.queue.currentIndex];
		return cur?.video_id === playback.now?.videoId ? cur : null;
	});
</script>

{#if np.open && playback.now}
	<div
		transition:fly={{ y: '100%', duration: 280, easing: cubicOut }}
		class="fixed inset-0 z-50 flex flex-col md:hidden bg-background text-foreground overflow-hidden select-none"
	>
		<!-- Vibrant Blurred Ambient Artwork Background -->
		{#if playback.now?.thumbnail}
			<div class="pointer-events-none absolute inset-0 overflow-hidden">
				<img
					src={thumb(playback.now.thumbnail, 400)}
					alt=""
					class="absolute -inset-10 h-[calc(100%+5rem)] w-[calc(100%+5rem)] object-cover opacity-50 dark:opacity-40 blur-3xl saturate-150 scale-125 transition-all duration-700"
				/>
				<div class="absolute inset-0 bg-gradient-to-b from-background/70 via-background/80 to-background/95 dark:from-background/60 dark:via-background/80 dark:to-background/95 backdrop-blur-2xl"></div>
			</div>
		{/if}

		<!-- Top Bar: Minimize Button + Header Title + Download + Add to Playlist -->
		<header class="relative z-10 flex h-14 shrink-0 items-center justify-between px-3 pt-1">
			<button
				type="button"
				class="flex size-10 items-center justify-center rounded-full text-foreground/80 hover:bg-muted/40 active:scale-95 transition cursor-pointer"
				onclick={() => (np.open = false)}
				aria-label="Minimize player"
				title="Minimize"
			>
				<HugeiconsIcon icon={ArrowDown01Icon} class="h-6 w-6" />
			</button>

			<div class="min-w-0 flex-1 px-2 text-center">
				<div class="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/90 truncate">
					{playback.queue.sourceName ? `Playing from ${playback.queue.sourceName}` : 'Now Playing'}
				</div>
			</div>

			<div class="flex items-center gap-0.5 shrink-0">
				<!-- Download Button in Header -->
				<button
					type="button"
					class="flex size-10 items-center justify-center rounded-full text-foreground/80 hover:bg-muted/40 active:scale-95 transition cursor-pointer"
					onclick={handleDownload}
					aria-label="Download track"
					title="Download track"
				>
					{#if downloading}
						<div class="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
					{:else}
						<HugeiconsIcon icon={Download01Icon} class="h-5 w-5" />
					{/if}
				</button>

				<!-- Add to playlist -->
				<button
					type="button"
					class="flex size-10 items-center justify-center rounded-full text-foreground/80 hover:bg-muted/40 active:scale-95 transition cursor-pointer"
					onclick={() => {
						const now = playback.now;
						if (now) {
							openAddToPlaylist({
								video_id: now.videoId,
								title: now.title,
								artists: now.artists,
								artist_id: now.artistId,
								thumbnail: now.thumbnail,
								duration: now.duration
							});
						}
					}}
					aria-label="Add to playlist"
				>
					<HugeiconsIcon icon={Add01Icon} class="h-5 w-5" />
				</button>
			</div>
		</header>

		<!-- Main Content Area -->
		<div class="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden px-5">
			{#if tab === 'cover'}
				<div class="flex h-full flex-col justify-between py-2">
					<!-- Album Artwork -->
					<div class="flex flex-1 items-center justify-center my-auto min-h-0 py-2">
						<button
							type="button"
							onclick={togglePlay}
							class="relative aspect-square w-full max-w-[min(78vw,340px)] rounded-3xl overflow-hidden shadow-2xl border border-white/10 cursor-pointer active:scale-[0.98] transition-transform"
							aria-label="Play/Pause"
						>
							{#if playback.now.thumbnail}
								<img
									src={thumb(playback.now.thumbnail, 720)}
									alt={playback.now.title || ''}
									class="h-full w-full object-cover"
								/>
							{:else}
								<div class="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
									<HugeiconsIcon icon={MusicNote01Icon} class="h-20 w-20 opacity-40" />
								</div>
							{/if}

							<!-- Play/Pause Flash Overlay -->
							{#if flash}
								<div
									in:scale={{ start: 0.7, duration: 150, easing: cubicOut }}
									out:scale={{ start: 1.3, duration: 300, easing: cubicOut }}
									class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-white"
								>
									<HugeiconsIcon
										icon={PauseIcon}
										altIcon={PlayIcon}
										showAlt={flash === 'play'}
										class="h-10 w-10"
									/>
								</div>
							{/if}
						</button>
					</div>

					<!-- Track Info, Download & Like Button -->
					<div class="flex items-center justify-between gap-3 pt-2 pb-1">
						<div class="min-w-0 flex-1">
							<h2 class="truncate text-lg font-bold tracking-tight text-foreground">
								{playback.now.title || 'Untitled'}
							</h2>
							<p class="truncate text-sm font-medium text-muted-foreground/90">
								{playback.now.artists || 'Unknown Artist'}
							</p>
						</div>

						<div class="flex items-center gap-1 shrink-0">
							<!-- Direct Download Button -->
							<button
								type="button"
								class="flex size-10 items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:scale-90 transition cursor-pointer"
								onclick={handleDownload}
								aria-label="Download track"
								title="Download track"
							>
								{#if downloading}
									<div class="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
								{:else}
									<HugeiconsIcon icon={Download01Icon} class="h-5 w-5" />
								{/if}
							</button>

							{#if !api.isLocalId(playback.now.videoId)}
								<button
									type="button"
									class="flex size-10 items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:scale-90 transition cursor-pointer"
									onclick={toggleLike}
									aria-label="Like track"
								>
									<span
										class="inline-flex"
										class:animate-heart-pop={justLiked}
										onanimationend={() => (justLiked = false)}
									>
										<HugeiconsIcon
											icon={FavouriteIcon}
											class="h-6 w-6 {playback.rating === 'like' ? 'fill-current text-primary' : ''}"
										/>
									</span>
								</button>
							{/if}
						</div>
					</div>

					<!-- Seekbar & Timestamps -->
					<div class="flex flex-col gap-1 py-1">
						<input
							type="range"
							min="0"
							max={playback.duration || 1}
							step="0.1"
							value={shownPosition}
							oninput={onSeekInput}
							onchange={onSeekCommit}
							class="h-1.5 w-full appearance-none rounded-full bg-muted/70 accent-primary cursor-pointer"
							aria-label="Seek track"
						/>
						<div class="flex justify-between text-[11px] font-medium text-muted-foreground/80">
							<span>{fmt(shownPosition)}</span>
							<span>{fmt(playback.duration)}</span>
						</div>
					</div>

					<!-- Transport Controls -->
					<div class="flex items-center justify-between px-2 pt-1 pb-3">
						<!-- Shuffle -->
						<button
							type="button"
							class="flex size-10 items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:scale-95 transition cursor-pointer relative"
							onclick={() => api.toggleShuffle()}
							aria-label="Shuffle"
						>
							<HugeiconsIcon
								icon={ShuffleIcon}
								class="h-5 w-5 {shuffleOn ? 'text-primary font-bold' : ''}"
							/>
							{#if shuffleOn}
								<span class="absolute bottom-1.5 size-1 rounded-full bg-primary"></span>
							{/if}
						</button>

						<!-- Previous -->
						<button
							type="button"
							class="flex size-11 items-center justify-center rounded-full text-foreground hover:bg-muted/40 active:scale-95 transition cursor-pointer"
							onclick={() => api.prevTrack()}
							aria-label="Previous track"
						>
							<HugeiconsIcon icon={PreviousIcon} class="h-6 w-6" />
						</button>

						<!-- Play / Pause -->
						<button
							type="button"
							class="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-2xl active:scale-95 transition-transform cursor-pointer"
							onclick={() => api.togglePause()}
							aria-label="Play/Pause"
						>
							<HugeiconsIcon
								icon={PauseIcon}
								altIcon={PlayIcon}
								showAlt={playback.paused}
								class="h-7 w-7"
							/>
						</button>

						<!-- Next -->
						<button
							type="button"
							class="flex size-11 items-center justify-center rounded-full text-foreground hover:bg-muted/40 active:scale-95 transition cursor-pointer"
							onclick={() => api.nextTrack()}
							aria-label="Next track"
						>
							<HugeiconsIcon icon={NextIcon} class="h-6 w-6" />
						</button>

						<!-- Repeat -->
						<button
							type="button"
							class="flex size-10 items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:scale-95 transition cursor-pointer relative"
							onclick={cycleRepeat}
							aria-label="Repeat: {repeat}"
						>
							<HugeiconsIcon
								icon={RepeatIcon}
								altIcon={RepeatOne01Icon}
								showAlt={repeat === 'one'}
								class="h-5 w-5 {repeat !== 'off' ? 'text-primary font-bold' : ''}"
							/>
							{#if repeat !== 'off'}
								<span class="absolute bottom-1.5 size-1 rounded-full bg-primary"></span>
							{/if}
						</button>
					</div>
				</div>
			{:else if tab === 'lyrics'}
				<div class="flex h-full flex-col overflow-hidden py-2" in:fade={{ duration: 150 }}>
					<LyricsView expanded={false} />
				</div>
			{:else if tab === 'queue'}
				<div class="flex h-full flex-col overflow-y-auto px-1 py-2" in:fade={{ duration: 150 }}>
					<QueueList />
				</div>
			{/if}
		</div>

		<!-- Bottom Tabs / Switcher -->
		<footer class="relative z-10 flex h-14 shrink-0 items-center justify-around border-t border-border/40 bg-card/60 backdrop-blur-xl px-4 pb-[env(safe-area-inset-bottom)]">
			<!-- Player / Cover -->
			<button
				type="button"
				class="flex flex-1 items-center justify-center gap-1.5 py-1 text-xs font-semibold transition cursor-pointer {tab === 'cover'
					? 'text-primary'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (tab = 'cover')}
			>
				<HugeiconsIcon icon={MusicNote01Icon} class="h-4 w-4" />
				<span>Player</span>
			</button>

			<!-- Lyrics -->
			<button
				type="button"
				class="flex flex-1 items-center justify-center gap-1.5 py-1 text-xs font-semibold transition cursor-pointer {tab === 'lyrics'
					? 'text-primary'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (tab = 'lyrics')}
			>
				<HugeiconsIcon icon={Mic01Icon} class="h-4 w-4" />
				<span>Lyrics</span>
			</button>

			<!-- Queue -->
			<button
				type="button"
				class="flex flex-1 items-center justify-center gap-1.5 py-1 text-xs font-semibold transition cursor-pointer {tab === 'queue'
					? 'text-primary'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (tab = 'queue')}
			>
				<HugeiconsIcon icon={Queue01Icon} class="h-4 w-4" />
				<span>Queue</span>
			</button>
		</footer>
	</div>
{/if}
