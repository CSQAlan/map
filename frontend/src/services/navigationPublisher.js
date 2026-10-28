// Keep one request in flight and coalesce pending progress into the latest state.
function createTargetPublisher({ fetcher = (...args) => fetch(...args), timeout = 8000 } = {}) {
  let active = false;
  let pending = null;
  let publication = 0;
  let revision = 0;
  async function request(job, version) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetcher(job.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...job.status, snapshot_revision: version }), signal: controller.signal,
      });
      if (response.status === 409) {
        const result = await response.json().catch(() => ({}));
        return { ok: false, current: result.detail?.snapshot_revision };
      }
      return { ok: response.ok };
    } catch { return { ok: false }; }
    finally { clearTimeout(timer); }
  }
  async function run(job) {
    active = true;
    let result = await request(job, ++revision);
    // Recover a server-issued baseline after reload/device changes. Only the
    // latest user state may retry; an obsolete progress request stays obsolete.
    if (!result.ok && Number.isSafeInteger(result.current) && result.current >= revision && job.id === publication) {
      revision = result.current + 1;
      result = await request(job, revision);
    }
    job.resolve(result.ok);
    active = false;
    const next = pending;
    pending = null;
    if (next) void run(next);
  }
  return function publish(url, status) {
    return new Promise(resolve => {
      const job = { url, status: structuredClone(status), id: ++publication, resolve };
      if (active) { pending?.resolve(false); pending = job; }
      else void run(job);
    });
  };
}

// Accounts have separate queues: a new elder must not replace another elder's end.
export function createNavigationPublisher(options = {}) {
  const publishers = new Map();
  return (url, status) => {
    if (!publishers.has(url)) publishers.set(url, createTargetPublisher(options));
    return publishers.get(url)(url, status);
  };
}
