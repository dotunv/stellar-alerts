import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement scrollIntoView; components that call it (e.g.
// CommandPalette's keyboard-nav auto-scroll) would otherwise throw in tests.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
