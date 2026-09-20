export const loginModal = $state({
	open: false
});

export function openLoginModal() {
	loginModal.open = true;
}

export function closeLoginModal() {
	loginModal.open = false;
}
