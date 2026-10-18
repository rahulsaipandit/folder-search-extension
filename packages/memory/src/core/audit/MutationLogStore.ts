import { openDB, type IDBPDatabase } from 'idb';
import type { IMutationLogStore, GetLogOptions } from './IMutationLogStore';
import type { MutationEvent } from './MutationEvent';

const DB_NAME = 'cognitive-brain-audit';
const DB_VERSION = 1;
const STORE_NAME = 'mutations';
const MAX_LOG_ENTRIES = 10_000;

// ---------------------------------------------------------------------------
// ID generation - prefer crypto.randomUUID when available (all modern browsers
// and Node 14.17+), fall back to a monotonic counter-based string otherwise.
// ---------------------------------------------------------------------------
let _idCounter = 0;

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mut-${Date.now()}-${++_idCounter}`;
}

// ---------------------------------------------------------------------------

export class MutationLogStore implements IMutationLogStore {
  private db: IDBPDatabase | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp');
          store.createIndex('entryId', 'entryId');
        }
      },
    });

    this.initialized = true;

    // Prune on startup - fire-and-forget, don't block caller.
    this._pruneOldEntries().catch(() => {});
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }

  async log(event: Omit<MutationEvent, 'id' | 'timestamp'>): Promise<void> {
    if (!this.db) return;

    const full: MutationEvent = {
      ...event,
      id: generateId(),
      timestamp: new Date().toISOString(),
    };

    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    await tx.objectStore(STORE_NAME).put(full);
    await tx.done;
  }

  async getLog(options: GetLogOptions = {}): Promise<MutationEvent[]> {
    if (!this.db) return [];

    const limit = options.limit ?? 100;
    const tx = this.db.transaction(STORE_NAME, 'readonly');
    const index = tx.objectStore(STORE_NAME).index('timestamp');

    // Walk cursor newest-first.
    let cursor = await index.openCursor(null, 'prev');
    const results: MutationEvent[] = [];

    while (cursor && results.length < limit) {
      const event = cursor.value as MutationEvent;
      const matchesEntryId = !options.entryId || event.entryId === options.entryId;
      const matchesOp = !options.operation || event.operation === options.operation;
      if (matchesEntryId && matchesOp) results.push(event);
      cursor = await cursor.continue();
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _pruneOldEntries(): Promise<void> {
    if (!this.db) return;

    // Fetch enough to detect overflow - newest-first so slice gives oldest.
    const all = await this.getLog({ limit: MAX_LOG_ENTRIES + 1000 });
    if (all.length <= MAX_LOG_ENTRIES) return;

    const toDelete = all.slice(MAX_LOG_ENTRIES); // oldest entries
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const event of toDelete) {
      store.delete(event.id);
    }
    await tx.done;
  }
}

export default MutationLogStore;
