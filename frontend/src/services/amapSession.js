// Share the initial SDK load and recover both our promise and the vendor cache.
export function createAmapSession(loader, options, { timeoutMs = 10000, cleanup = () => {} } = {}) {
  let pending;
  return {
    load() {
      if (pending) return pending;
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new DOMException('Map SDK timed out', 'TimeoutError')), timeoutMs);
      });
      pending = Promise.race([Promise.resolve().then(() => loader.load(options)), deadline])
        .catch(error => {
          cleanup();
          // Removing a downloading script cannot guarantee its cancellation.
          // Keep timed-out loads terminal so a late global SDK callback never
          // overlaps another attempt. A full page reload is the safe recovery.
          if (error?.name === 'TimeoutError') {
            error.requiresPageReload = true;
            throw error;
          }
          loader.reset();
          pending = undefined;
          throw error;
        })
        .finally(() => clearTimeout(timer));
      return pending;
    },
  };
}
