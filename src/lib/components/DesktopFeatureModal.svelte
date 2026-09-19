<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { ComputerIcon, Download01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';
	import { desktopModal, closeDesktopFeature } from '$lib/desktopModal.svelte';

	function openDownload() {
		window.open('https://neo-xd.github.io/nocturne/#download', '_blank');
		closeDesktopFeature();
	}
</script>

<Dialog.Root bind:open={desktopModal.open}>
	<Dialog.Content class="sm:max-w-md border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl">
		<div class="flex items-center gap-3.5 mb-1">
			<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
				<HugeiconsIcon icon={ComputerIcon} class="h-6 w-6" />
			</div>
			<div>
				<div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Desktop App Exclusive</div>
				<Dialog.Title class="text-lg font-bold tracking-tight text-foreground">{desktopModal.feature.name}</Dialog.Title>
			</div>
		</div>

		<Dialog.Description class="text-sm leading-relaxed text-muted-foreground mt-2">
			{desktopModal.feature.description}
		</Dialog.Description>

		<div class="mt-4 rounded-lg border border-border/50 bg-accent/5 p-3 text-xs text-muted-foreground leading-normal">
			💡 Nocturne Desktop offers native performance, local SQLite cache, OS keybinds, Discord RPC, and Listen Together.
		</div>

		<div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button variant="outline" onclick={closeDesktopFeature} class="cursor-pointer">
				Dismiss
			</Button>
			<Button onclick={openDownload} class="flex items-center gap-2 cursor-pointer bg-primary text-primary-foreground">
				<HugeiconsIcon icon={Download01Icon} class="h-4 w-4" />
				<span>Download Desktop</span>
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
