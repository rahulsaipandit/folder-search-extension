export declare const ownerId: `${string}-${string}-${string}-${string}-${string}`;
/**
 * Atomically acquire lease for a widget instance
 * Returns true if lease was successfully acquired
 */
export declare function acquireLease(instanceId: string): Promise<boolean>;
/**
 * Extend lease for an owned instance
 * Returns false if lease was lost
 */
export declare function heartbeatLease(instanceId: string): Promise<boolean>;
/**
 * Release an owned lease
 */
export declare function releaseLease(instanceId: string): Promise<void>;
/**
 * Reclaim all expired leases
 * Runs on service worker startup and periodically
 */
export declare function reclaimExpiredLeases(): Promise<number>;
/**
 * Check if current context holds valid lease for instance
 */
export declare function holdsLease(instanceId: string): Promise<boolean>;
/**
 * Start heartbeat timer for active leases
 */
export declare function startLeaseHeartbeat(activeInstances: Set<string>): () => void;
