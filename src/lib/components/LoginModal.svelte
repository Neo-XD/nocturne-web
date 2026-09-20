<script lang="ts">
	import { loginModal, closeLoginModal } from '$lib/loginModal.svelte';
	import {
		signInWithGoogleOAuth,
		getStoredOAuthSession,
		clearOAuthSession,
		getGoogleClientId
	} from '$lib/oauth';
	import { ytmGetAccount, setStoredCookie } from '$lib/ytmusic';
	import { emitWebEvent } from '$lib/webEngine';
	import { Button } from '$lib/components/ui/button';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import {
		Cancel01Icon,
		Download01Icon,
		UserIcon,
		CheckmarkCircle02Icon,
		Alert02Icon,
		Logout01Icon
	} from '@hugeicons/core-free-icons';

	let cookieInput = $state('');
	let showCookieOption = $state(false);

	let loading = $state(false);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);

	let currentSession = $derived(getStoredOAuthSession());

	async function handleGoogleOAuth() {
		const cid = getGoogleClientId();
		if (!cid) {
			error = 'Google OAuth Client ID is not configured.';
			return;
		}

		loading = true;
		error = null;
		success = null;

		try {
			const account = await signInWithGoogleOAuth();
			success = `Signed in as ${account.name}!`;
			setTimeout(() => {
				closeLoginModal();
				success = null;
			}, 1200);
		} catch (e: any) {
			error = e.message || 'Google Sign-In was cancelled or failed.';
		} finally {
			loading = false;
		}
	}

	function handleSignOut() {
		clearOAuthSession();
		setStoredCookie(null);
		success = 'Signed out successfully.';
		setTimeout(() => {
			closeLoginModal();
			success = null;
		}, 1000);
	}

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
			class="relative w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl p-6 text-foreground overflow-hidden"
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
			<div class="flex items-center gap-3 mb-6">
				<div class="p-2.5 rounded-xl bg-primary/10 text-primary">
					<HugeiconsIcon icon={UserIcon} class="size-6" />
				</div>
				<div>
					<h3 class="text-lg font-bold">Sign in to Nocturne</h3>
					<p class="text-xs text-muted-foreground">Access your playlists and customized library</p>
				</div>
			</div>

			{#if currentSession?.account?.signedIn}
				<!-- Signed In State -->
				<div class="rounded-xl border border-border bg-muted/20 p-5 space-y-4">
					<div class="flex items-center gap-3">
						{#if currentSession.account.thumbnail}
							<img
								src={currentSession.account.thumbnail}
								alt="Avatar"
								class="size-12 rounded-full border border-border object-cover"
							/>
						{:else}
							<div class="size-12 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
								{currentSession.account.name?.charAt(0) || 'U'}
							</div>
						{/if}
						<div class="min-w-0 flex-1">
							<p class="font-semibold text-sm truncate">{currentSession.account.name}</p>
							<p class="text-xs text-muted-foreground truncate">{currentSession.account.email || currentSession.account.handle}</p>
						</div>
					</div>

					<div class="pt-2 flex justify-end gap-2">
						<Button variant="ghost" size="sm" onclick={closeLoginModal}>Close</Button>
						<Button variant="destructive" size="sm" onclick={handleSignOut}>
							<HugeiconsIcon icon={Logout01Icon} class="size-4 mr-1.5" />
							<span>Sign Out</span>
						</Button>
					</div>
				</div>
			{:else}
				<!-- Not Signed In State -->
				<div class="space-y-4">
					<!-- Primary: Google OAuth 2.0 Sign In -->
					<div class="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3.5">
						<div class="space-y-1">
							<h4 class="text-sm font-semibold flex items-center gap-2">
								<svg class="size-4" viewBox="0 0 24 24">
									<path
										fill="#4285F4"
										d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
									/>
									<path
										fill="#34A853"
										d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
									/>
									<path
										fill="#FBBC05"
										d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
									/>
									<path
										fill="#EA4335"
										d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
									/>
								</svg>
								<span>Google OAuth 2.0 Sign In</span>
							</h4>
							<p class="text-xs text-muted-foreground leading-relaxed">
								Sign in with your Google Account to automatically sync and access your YouTube playlists.
							</p>
						</div>

						<Button
							class="w-full font-medium"
							disabled={loading}
							onclick={handleGoogleOAuth}
						>
							{#if loading}
								<span>Connecting to Google...</span>
							{:else}
								<svg class="size-4 mr-2" viewBox="0 0 24 24">
									<path
										fill="#4285F4"
										d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
									/>
									<path
										fill="#34A853"
										d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
									/>
									<path
										fill="#FBBC05"
										d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
									/>
									<path
										fill="#EA4335"
										d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
									/>
								</svg>
								<span>Sign In with Google</span>
							{/if}
						</Button>


					</div>

					<!-- Status notifications -->
					{#if error}
						<div class="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
							<HugeiconsIcon icon={Alert02Icon} class="size-4 shrink-0" />
							<span>{error}</span>
						</div>
					{/if}

					{#if success}
						<div class="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
							<HugeiconsIcon icon={CheckmarkCircle02Icon} class="size-4 shrink-0" />
							<span>{success}</span>
						</div>
					{/if}

					<!-- Secondary: Official App or Cookie Option -->
					<div class="space-y-2 pt-1 border-t border-border/60">
						<div class="flex items-center justify-between text-xs text-muted-foreground pt-1">
							<span>Want full 1-click desktop features?</span>
							<a
								href="https://neo-xd.github.io/nocturne/#download"
								target="_blank"
								rel="noopener noreferrer"
								class="text-primary hover:underline inline-flex items-center gap-1 font-medium"
							>
								<span>Nocturne App</span>
								<HugeiconsIcon icon={Download01Icon} class="size-3" />
							</a>
						</div>

						<div>
							<button
								type="button"
								class="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
								onclick={() => (showCookieOption = !showCookieOption)}
							>
								{showCookieOption ? 'Hide' : 'Alternative: paste YouTube Music cookie'}
							</button>

							{#if showCookieOption}
								<div class="mt-2 p-3 rounded-lg border border-border/70 bg-background/50 space-y-2">
									<textarea
										bind:value={cookieInput}
										placeholder="SAPISID=...; __Secure-3PAPISID=...;"
										rows="2"
										class="w-full text-xs font-mono rounded border border-input bg-background/80 px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none placeholder:text-muted-foreground/40"
									></textarea>
									<div class="flex justify-end">
										<Button size="sm" variant="secondary" disabled={loading || !cookieInput.trim()} onclick={handleCookieSignIn}>
											Authenticate Cookie
										</Button>
									</div>
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
