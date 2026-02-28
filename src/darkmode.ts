// Apply dark mode class based on system preference
// This must run before the popup renders to avoid flash of unstyled content
if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
  document.documentElement.classList.add("dark");
}
