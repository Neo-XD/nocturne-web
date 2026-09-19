<script lang="ts">
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { RefreshIcon } from '@hugeicons/core-free-icons';
	import { Button } from '$lib/components/ui/button';

	let { message, onRetry }: { message: string; onRetry: () => void } = $props();
</script>

<div class="flex flex-col items-start gap-3">
	<p class="text-sm text-destructive">{message}</p>
	<!-- shadcn's Button spreads onclick straight onto the real <button>, so passing `onRetry` directly
	     would hand the callback a MouseEvent — any retry handler with an optional parameter (like
	     home's `load`) would silently receive it as an argument instead of its default. -->
	<Button variant="outline" size="sm" class="gap-2" onclick={() => onRetry()}>
		<HugeiconsIcon icon={RefreshIcon} class="h-4 w-4" /> Try again
	</Button>
</div>
