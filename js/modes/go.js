// Cross-mode navigation without an import cycle. The mode controller imports the
// registry, the registry imports every tab render (including the Home pages), so
// a Home page importing the controller directly would close the loop. Instead
// Home pages call goTo(), which fires an `app:navigate` event the controller
// listens for. Leaf module — imports nothing.

export function goTo(mode, tab) {
  document.dispatchEvent(new CustomEvent('app:navigate', { detail: { mode, tab } }));
}
