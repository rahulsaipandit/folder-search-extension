import { open, type DB } from '@op-engineering/op-sqlite';
import type { IMutationLogStore, GetLogOptions } from './IMutationLogStore';
import type { MutationEvent } from './MutationEvent';

const DB_FILENAME = 'cognitive-brain-audit.db';
const MAX_LOG_ENTRIES = 10_000;

// ---------------------------------------------------------------------------
// ID generation - React Native does not ship Web Crypto by default, so fall
// back to a timestamp + counter string when randomUUID is unavailable.
// ---------------------------------------------------------------------------
let _idCounter = 0;

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
    return (crypto as any).randomUUID() as string;
  }
  return `mut-${Date.now()}-${++_idCounter}`;
}

// ---------------------------------------------------------------------------

export class MutationLogStore implements IMutationLogStore {
  private db: DB | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.db = open({ name: DB_FILENAME });

    this.db.execute(`
      CREATE TABLE IF NOT EXISTS memory_mutations (
        id           TEXT PRIMARY KEY,
        timestamp    TEXT NOT NULL,
        operation    TEXT NOT NULL,
        entry_id     TEXT NOT NULL,
        entry_type   TEXT NOT NULL,
        summary      TEXT NOT NULL,
        processor_name TEXT,
        metadata     TEXT
      )
    `);

    this.db.execute(
      'CREATE INDEX IF NOT EXISTS idx_cb_mutations_ts    ON memory_mutations(timestamp)'
    );
    this.db.execute(
      'CREATE INDEX IF NOT EXISTS idx_cb_mutations_entry ON memory_mutations(entry_id)'
    );

    // Prune to stay within cap - keep the MAX_LOG_ENTRIES newest rows.
    this.db.execute(`
      DELETE FROM memory_mutations
      WHERE id NOT IN (
        SELECT id FROM memory_mutations ORDER BY timestamp DESC LIMIT ${MAX_LOG_ENTRIES}
      )
    `);

    this.initialized = true;
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

    this.db.execute(
      `INSERT INTO memory_mutations
         (id, timestamp, operation, entry_id, entry_type, summary, processor_name, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateId(),
        new Date().toISOString(),
        event.operation,
        event.entryId,
        event.entryType,
        event.summary,
        event.processorName ?? null,
        event.metadata ? JSON.stringify(event.metadata) : null,
      ]
    );
  }

  async getLog(options: GetLogOptions = {}): Promise<MutationEvent[]> {
    if (!this.db) return [];

    const conditions: string[] = [];
    const params: any[] = [];

    if (options.entryId) {
      conditions.push('entry_id = ?');
      params.push(options.entryId);
    }
    if (options.operation) {
      conditions.push('operation = ?');
      params.push(options.operation);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit ?? 100;

    const result = this.db.execute(
      `SELECT * FROM memory_mutations ${where} ORDER BY timestamp DESC LIMIT ?`,
      [...params, limit]
    );

    return (result.rows ?? []).map((row: any): MutationEvent => ({
      id: row.id,
      timestamp: row.timestamp,
      operation: row.operation as MutationEvent['operation'],
      entryId: row.entry_id,
      entryType: row.entry_type,
      summary: row.summary,
      processorName: row.processor_name ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }
}

export default MutationLogStore;
