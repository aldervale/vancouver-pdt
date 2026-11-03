// Keep optional Google Fonts non-blocking without an inline onload handler.
// A cached stylesheet may finish before this deferred script executes.
(() => {
  const link = document.querySelector('link[data-optional-fonts]');
  if (!(link instanceof HTMLLinkElement)) return;
  const activate = () => { link.media = 'all'; };
  link.addEventListener('load', activate, { once: true });
  if (link.sheet) activate();
})();
