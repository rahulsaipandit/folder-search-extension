import type { MemoryType } from '../../types';

export interface MutationEvent {
  id: string;
  timestamp: string;
  operation: 'create' | 'update' | 'delete';
  entryId: string;
  entryType: MemoryType;
  /** Human-readable one-liner, e.g. "Created episodic: User asked about React" */
  summary: string;
  /** Set when mutation was triggered by a pipeline processor */
  processorName?: string;
  metadata?: Record<string, any>;
}
