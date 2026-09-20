<script lang="ts">
	import { loginModal, closeLoginModal } from '$lib/loginModal.svelte';
	import { ytmGetAccount, setStoredCookie } from '$lib/ytmusic';
	import { emitWebEvent } from '$lib/webEngine';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Cancel01Icon,
		Download01Icon,
		UserIcon,
		CheckmarkCircle02Icon,
		Alert02Icon,
		SecurityCheckIcon
	} from '@hugeicons/core-free-icons';

	let cookieInput = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);

	async function handleCookieSignIn() {
		if (!cookieInput.trim()) {
			error = 'Please paste your YouTube Music cookie.';
			return;
		}

		loading = true;
		error = null;
		success = null;

		try {
			setStoredCookie(cookieInput.trim());
			const account = await ytmGetAccount();

			if (!account.signedIn) {
				error = 'Could not authenticate with this cookie. Make sure it contains SAPISID from music.youtube.com.';
				setStoredCookie(null);
			} else {
				success = `Signed in as ${account.name || account.handle || 'YouTube User'}!`;
				emitWebEvent('auth-changed', account);
				setTimeout(() => {
					closeLoginModal();
					success = null;
					cookieInput = '';
				}, 1200);
			}
		} catch (e: any) {
			error = e.message || 'Failed to sign in.';
			setStoredCookie(null);
		} finally {
			loading = false;
		}
	}
</script>

{#if loginModal.open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200"
		role="dialog"
		aria-modal="true"
	>
		<div
			class="relative w-full max-w-lg rounded-2xl bg-card border border-border/80 shadow-2xl p-6 text-foreground overflow-hidden"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Close button -->
			<button
				type="button"
				class="absolute top-4 right-4 p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
				onclick={closeLoginModal}
				aria-label="Close"
			>
				<HugeiconsIcon icon={Cancel01Icon} class="size-5" />
			</button>

			<!-- Header -->
			<div class="flex items-center gap-3 mb-5">
				<div class="p-2.5 rounded-xl bg-primary/10 text-primary">
					<HugeiconsIcon icon={UserIcon} class="size-6" />
				</div>
				<div>
					<h3 class="text-lg font-bold">Sign in to Nocturne</h3>
					<p class="text-xs text-muted-foreground">Access your YouTube Music library and playlists</p>
				</div>
			</div>

			<!-- Options -->
			<div class="space-y-4">
				<!-- Option 1: Native Apps with 1-click Google Sign-in -->
				<div class="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2.5">
					<div class="flex items-center gap-2 text-primary font-semibold text-sm">
						<HugeiconsIcon icon={Download01Icon} class="size-4" />
						<span>Recommended: Nocturne Desktop & Android</span>
					</div>
					<p class="text-xs text-muted-foreground leading-relaxed">
						Google strictly isolates web cookies across different browser domains. For automatic 1-click Google Sign-in, persistent logins, and high-fidelity audio, use the official Nocturne Desktop or Android apps.
					</p>
					<a
						href="https://neo-xd.github.io/nocturne/#download"
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-2 text-xs font-medium px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
					>
						<span>Get Official Nocturne App</span>
						<HugeiconsIcon icon={Download01Icon} class="size-3.5" />
					</a>
				</div>

				<!-- Option 2: Browser Cookie Sign-in -->
				<div class="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
					<div class="flex items-center gap-2 text-foreground font-semibold text-sm">
						<HugeiconsIcon icon={SecurityCheckIcon} class="size-4 text-emerald-400" />
						<span>Or Sign In on Web (Session Cookie)</span>
					</div>
					<p class="text-xs text-muted-foreground leading-relaxed">
						To sign in directly on this browser, copy your <code>Cookie</code> header from <strong>music.youtube.com</strong> (containing <code>SAPISID</code>) and paste it below:
					</p>

					<div class="space-y-2">
						<textarea
							bind:value={cookieInput}
							placeholder="SAPISID=...; __Secure-3PAPISID=...;"
							rows="3"
							class="w-full text-xs font-mono rounded-lg border border-input bg-background/80 px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none placeholder:text-muted-foreground/50"
						></textarea>

						{#if error}
							<div class="flex items-center gap-1.5 text-xs text-destructive">
								<HugeiconsIcon icon={Alert02Icon} class="size-3.5 shrink-0" />
								<span>{error}</span>
							</div>
						{/if}

						{#if success}
							<div class="flex items-center gap-1.5 text-xs text-emerald-400">
								<HugeiconsIcon icon={CheckmarkCircle02Icon} class="size-3.5 shrink-0" />
								<span>{success}</span>
							</div>
						{/if}

						<div class="flex justify-end gap-2 pt-1">
							<Button variant="ghost" size="sm" onclick={closeLoginModal}>Cancel</Button>
							<Button size="sm" disabled={loading || !cookieInput.trim()} onclick={handleCookieSignIn}>
								{loading ? 'Authenticating...' : 'Sign In'}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
