export interface DesktopFeatureInfo {
	name: string;
	description: string;
	icon?: string;
}

export const desktopModal = $state({
	open: false,
	feature: {
		name: '',
		description: '',
		icon: 'desktop'
	} as DesktopFeatureInfo
});

export function showDesktopFeature(name: string, description?: string, icon?: string) {
	desktopModal.feature = {
		name,
		description:
			description ||
			`The "${name}" feature requires native system integration and is available in Nocturne Desktop.`,
		icon: icon || 'desktop'
	};
	desktopModal.open = true;
}

export function closeDesktopFeature() {
	desktopModal.open = false;
}
