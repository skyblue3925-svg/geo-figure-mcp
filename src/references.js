import { randomBytes } from 'node:crypto';

// The remote process serves independent MCP requests. Possession of an unlisted,
// random handle grants access to one entry, even when teachers share a login URL.
export function referenceStore(limit, idBytes, now = Date.now) {
  const entries = new Map();
  const ttl = 30 * 60 * 1000;
  function purge() {
    for (const [id, entry] of entries) {
      if (entry.expires > now()) break;
      entries.delete(id);
    }
  }
  return {
    purge,
    put(value) {
      purge();
      if (entries.size >= limit) entries.delete(entries.keys().next().value);
      const id = randomBytes(idBytes).toString('hex');
      entries.set(id, { value, expires: now() + ttl });
      return id;
    },
    get(id) {
      purge();
      return entries.get(id)?.value;
    },
  };
}

export function createReferences(remote = false) {
  return {
    previews: referenceStore(remote ? 128 : 8, remote ? 24 : 8),
    questions: referenceStore(remote ? 128 : 8, remote ? 24 : 8),
    datasets: referenceStore(remote ? 64 : 8, 24),
  };
}
