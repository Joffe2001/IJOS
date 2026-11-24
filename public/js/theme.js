// Runs before first paint (classic script) so the saved theme never flashes. Values: light | dark | system.
document.documentElement.dataset.theme = localStorage.getItem('ijos-theme') || 'system';
