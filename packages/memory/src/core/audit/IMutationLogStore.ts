import type { MutationEvent } from './MutationEvent';

export interface GetLogOptions {
  limit?: number;
  entryId?: string;
  operation?: MutationEvent['operation'];
}

export interface IMutationLogStore {
  /** Persist a mutation event. id and timestamp are assigned by the store. */
  log(event: Omit<MutationEvent, 'id' | 'timestamp'>): Promise<void>;

  /** Retrieve recent mutation events, newest first. */
  getLog(options?: GetLogOptions): Promise<MutationEvent[]>;

  /** Open / migrate the underlying storage. Must be called before log/getLog. */
  initialize(): Promise<void>;

  /** Release any held resources (DB connections, file handles). */
  close(): Promise<void>;
}
