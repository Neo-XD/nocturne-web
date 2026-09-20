<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		PlayIcon,
		PauseIcon,
		NextIcon,
		FavouriteIcon
	} from '@hugeicons/core-free-icons';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import * as api from '$lib/api';
	import { np, playback, toggleNowPlayingLike } from '$lib/player.svelte';
	import { thumb } from '$lib/thumb';

	let justLiked = $state(false);

	function toggleLike(e: MouseEvent) {
		e.stopPropagation();
		if (playback.rating !== 'like') justLiked = true;
		toggleNowPlayingLike();
	}

	function togglePlay(e: MouseEvent) {
		e.stopPropagation();
		api.togglePause();
	}

	function handleNext(e: MouseEvent) {
		e.stopPropagation();
		api.nextTrack();
	}

	const progress = $derived.by(() => {
		if (!playback.duration || playback.duration <= 0) return 0;
		return Math.min(100, Math.max(0, (playback.position / playback.duration) * 100));
	});
</script>

{#if playback.now && !np.open}
	<div
		transition:fly={{ y: 24, duration: 200, easing: cubicOut }}
		class="fixed bottom-[3.75rem] left-2.5 right-2.5 z-40 md:hidden overflow-hidden rounded-xl border border-border/80 bg-card/90 shadow-xl backdrop-blur-2xl cursor-pointer select-none"
		onclick={() => (np.open = true)}
		role="button"
		tabindex="0"
		onkeydown={(e) => e.key === 'Enter' && (np.open = true)}
		aria-label="Open now playing"
	>
		<!-- Progress bar along the bottom of the card -->
		<div class="absolute inset-x-0 bottom-0 h-0.5 bg-muted/50">
			<div
				class="h-full bg-primary transition-all duration-200 ease-linear"
				style="width: {progress}%"
			></div>
		</div>

		<div class="flex h-13 items-center justify-between gap-2.5 px-2.5 py-1.5">
			<!-- Artwork & Track Details -->
			<div class="flex min-w-0 flex-1 items-center gap-2.5">
				{#if playback.now.thumbnail}
					<img
						src={thumb(playback.now.thumbnail, 120)}
						alt=""
						class="size-10 shrink-0 rounded-lg object-cover shadow-sm"
					/>
				{:else}
					<div class="size-10 shrink-0 rounded-lg bg-muted flex items-center justify-center">
						<span class="text-xs text-muted-foreground font-bold">♪</span>
					</div>
				{/if}

				<div class="min-w-0 flex-1">
					<div class="truncate text-xs font-semibold leading-snug">
						{playback.now.title || 'Untitled'}
					</div>
					<div class="truncate text-[11px] text-muted-foreground leading-snug">
						{playback.now.artists || 'Unknown Artist'}
					</div>
				</div>
			</div>

			<!-- Actions -->
			<div class="flex shrink-0 items-center gap-0.5">
				{#if !api.isLocalId(playback.now.videoId)}
					<button
						type="button"
						class="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-foreground cursor-pointer"
						onclick={toggleLike}
						aria-label="Like"
					>
						<span
							class="inline-flex"
							class:animate-heart-pop={justLiked}
							onanimationend={() => (justLiked = false)}
						>
							<HugeiconsIcon
								icon={FavouriteIcon}
								class="h-4 w-4 {playback.rating === 'like' ? 'fill-current text-primary' : ''}"
							/>
						</span>
					</button>
				{/if}

				<button
					type="button"
					class="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm cursor-pointer active:scale-95 transition-transform"
					onclick={togglePlay}
					aria-label="Play/Pause"
				>
					<HugeiconsIcon
						icon={PauseIcon}
						altIcon={PlayIcon}
						showAlt={playback.paused}
						class="h-4 w-4"
					/>
				</button>

				<button
					type="button"
					class="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-foreground cursor-pointer active:scale-95 transition-transform"
					onclick={handleNext}
					aria-label="Next track"
				>
					<HugeiconsIcon icon={NextIcon} class="h-4 w-4" />
				</button>
			</div>
		</div>
	</div>
{/if}
