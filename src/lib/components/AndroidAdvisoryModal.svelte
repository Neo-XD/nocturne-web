<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { SmartPhone01Icon, Download01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';

	let open = $state(false);

	function isAndroidPhone(): boolean {
		if (!browser) return false;
		const ua = navigator.userAgent;
		// Android phones include both 'Android' and 'Mobile'. Android tablets omit 'Mobile'.
		return /Android/i.test(ua) && /Mobile/i.test(ua);
	}

	onMount(() => {
		if (isAndroidPhone()) {
			const dismissed = sessionStorage.getItem('nocturne_android_advisory_dismissed');
			if (!dismissed) {
				open = true;
			}
		}
	});

	function dismiss() {
		if (browser) {
			sessionStorage.setItem('nocturne_android_advisory_dismissed', 'true');
		}
		open = false;
	}

	function downloadAndroid() {
		window.open('https://github.com/Neo-XD/nocturne-mobile/releases', '_blank');
		dismiss();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl">
		<div class="flex items-center gap-3.5 mb-1">
			<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
				<HugeiconsIcon icon={SmartPhone01Icon} class="h-6 w-6" />
			</div>
			<div>
				<div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Detected Android Phone</div>
				<Dialog.Title class="text-lg font-bold tracking-tight text-foreground">Official App Available</Dialog.Title>
			</div>
		</div>

		<Dialog.Description class="text-sm leading-relaxed text-muted-foreground mt-2">
			For the best mobile experience with background playback, lock-screen controls, and offline listening, we recommend using the native <strong>Nocturne Android App</strong>.
		</Dialog.Description>

		<div class="mt-4 rounded-lg border border-border/50 bg-accent/5 p-3 text-xs text-muted-foreground leading-normal">
			📱 You can still enjoy the Nocturne Web Interface directly on your phone if you prefer not to install the app.
		</div>

		<div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<Button variant="outline" onclick={dismiss} class="cursor-pointer">
				Continue in Browser
			</Button>
			<Button onclick={downloadAndroid} class="flex items-center gap-2 cursor-pointer bg-primary text-primary-foreground">
				<HugeiconsIcon icon={Download01Icon} class="h-4 w-4" />
				<span>Download Android App</span>
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
