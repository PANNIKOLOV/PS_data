/**
 * Applies the stored theme before first paint.
 *
 * Runs as a blocking inline script on purpose: deferring it to a React effect
 * would let the light theme paint first and flash on a dark-theme reload.
 */
const SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('ps-data-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored === 'dark' || (stored !== 'light' && prefersDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (error) {
    /* Private browsing can make localStorage throw; the light theme is fine. */
  }
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
