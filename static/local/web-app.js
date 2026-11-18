(() => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' })
        .catch((error) => console.warn('DeepSeek_API offline shell is unavailable.', error));
    }, { once: true });
  }

  if (navigator.standalone || window.matchMedia('(display-mode: standalone)').matches) {
    window.addEventListener('pointerdown', () => {
      void navigator.storage?.persist?.().catch(() => {});
    }, { once: true });
  }
})();
