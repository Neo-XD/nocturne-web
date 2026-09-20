<svelte:head>
	<title>Privacy Policy — Nocturne</title>
</svelte:head>

<div class="max-w-3xl mx-auto px-6 py-12 text-foreground space-y-8 leading-relaxed">
	<div>
		<a href="/" class="text-xs text-primary hover:underline font-medium mb-3 inline-block">← Back to Nocturne</a>
		<h1 class="text-3xl font-bold tracking-tight">Privacy Policy</h1>
		<p class="text-xs text-muted-foreground mt-1">Last updated: September 20, 2026</p>
	</div>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold text-foreground">1. Overview</h2>
		<p class="text-sm text-muted-foreground">
			Nocturne Web ("Nocturne", "we", "us", or "our") is an open-source web application interface for exploring and listening to music. We are committed to protecting your personal privacy. This Privacy Policy explains how your data is handled when you use Nocturne Web.
		</p>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold text-foreground">2. Information We Access and Collect</h2>
		<p class="text-sm text-muted-foreground">
			Nocturne operates on a <strong>client-side architecture</strong>. We do not maintain user accounts on private remote database servers. When you choose to sign in with Google:
		</p>
		<ul class="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
			<li><strong>Basic Profile Information:</strong> Your Google name, email address, and profile avatar (via Google OAuth 2.0).</li>
			<li><strong>YouTube Data:</strong> Read-only access to your YouTube playlists and channel identifiers to display your music library in the Nocturne interface.</li>
			<li><strong>Local Client Preferences:</strong> Volume levels, playback queue state, and theme settings are saved locally in your browser's <code>localStorage</code>.</li>
		</ul>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold text-foreground">3. How We Use Your Information</h2>
		<p class="text-sm text-muted-foreground">
			Any data retrieved from Google or YouTube APIs is used <strong>solely to provide direct functionality within your browser</strong>:
		</p>
		<ul class="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
			<li>To display your profile name and avatar in the user interface.</li>
			<li>To fetch and render your personal music playlists in your library.</li>
			<li>We <strong>do not</strong> sell, rent, monetize, or share your personal information with third parties or advertisers.</li>
			<li>We <strong>do not</strong> transfer or disclose your Google user data to external servers or third-party AI models.</li>
		</ul>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold text-foreground">4. Google API Services User Data Policy Compliance</h2>
		<p class="text-sm text-muted-foreground">
			Nocturne's use and transfer of information received from Google APIs to any other app will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">Google API Services User Data Policy</a>, including the Limited Use requirements.
		</p>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold text-foreground">5. Data Retention and Deletion</h2>
		<p class="text-sm text-muted-foreground">
			Your session credentials and tokens reside entirely on your device in your browser's local storage. You can immediately delete all stored authentication and preference data at any time by:
		</p>
		<ul class="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
			<li>Clicking the <strong>Sign Out</strong> button in the Nocturne user account menu.</li>
			<li>Clearing cookies and website data for this site in your web browser settings.</li>
			<li>Revoking access directly from your Google Account at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">Google Account Permissions</a>.</li>
		</ul>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold text-foreground">6. Third-Party Services</h2>
		<p class="text-sm text-muted-foreground">
			Nocturne interfaces with third-party public services including YouTube and LRCLIB (for synchronized lyrics). Your use of these services is subject to their respective terms and privacy policies:
		</p>
		<ul class="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
			<li><a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">Google Privacy Policy</a></li>
			<li><a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">YouTube Terms of Service</a></li>
		</ul>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold text-foreground">7. Contact & Source Code</h2>
		<p class="text-sm text-muted-foreground">
			Nocturne is an open-source project. If you have any questions regarding this Privacy Policy or data handling, you can inspect the full source code or open an issue on GitHub:
		</p>
		<p class="text-sm">
			<a href="https://github.com/Neo-XD/nocturne-web" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">https://github.com/Neo-XD/nocturne-web</a>
		</p>
	</section>
</div>
