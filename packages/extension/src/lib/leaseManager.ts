import { getDB } from './db'
import type { Lease } from './db'

const LEASE_DURATION = 15000 // 15 seconds
const HEARTBEAT_INTERVAL = 5000 // 5 seconds
const GRACE_PERIOD = 3000 // 3 seconds

export const ownerId = crypto.randomUUID()

/**
 * Atomically acquire lease for a widget instance
 * Returns true if lease was successfully acquired
 */
export async function acquireLease(instanceId: string): Promise<boolean> {
  const db = await getDB()
  const tx = db.transaction('leases', 'readwrite')
  const store = tx.store

  const existing = await store.get(instanceId as any)
  
  const now = Date.now()
  
  if (!existing || existing.expiresAt < now) {
    const lease: Lease = {
      instanceId,
      ownerId,
      expiresAt: now + LEASE_DURATION,
      heartbeatAt: now
    }
    
    await store.put(lease)
    await tx.done
    
    return true
  }
  
  tx.abort()
  return false
}

/**
 * Extend lease for an owned instance
 * Returns false if lease was lost
 */
export async function heartbeatLease(instanceId: string): Promise<boolean> {
  const db = await getDB()
  const tx = db.transaction('leases', 'readwrite')
  const store = tx.store

  const existing = await store.get(instanceId as any)
  
  if (!existing || existing.ownerId !== ownerId) {
    tx.abort()
    return false
  }
  
  const now = Date.now()
  existing.expiresAt = now + LEASE_DURATION
  existing.heartbeatAt = now
  
  await store.put(existing)
  await tx.done
  
  return true
}

/**
 * Release an owned lease
 */
export async function releaseLease(instanceId: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('leases', 'readwrite')
  const store = tx.store

  const existing = await store.get(instanceId as any)
  
  if (existing && existing.ownerId === ownerId) {
    await store.delete(instanceId as any)
  }
  
  await tx.done
}

/**
 * Reclaim all expired leases
 * Runs on service worker startup and periodically
 */
export async function reclaimExpiredLeases(): Promise<number> {
  const db = await getDB()
  const tx = db.transaction('leases', 'readwrite')
  const store = tx.store
  
  const now = Date.now()
  let reclaimed = 0
  
  const allLeases = await store.getAll()
  
  for (const lease of allLeases) {
    if (lease.expiresAt + GRACE_PERIOD < now) {
      await store.delete(lease.instanceId as any)
      reclaimed++
    }
  }
  
  await tx.done
  return reclaimed
}

/**
 * Check if current context holds valid lease for instance
 */
export async function holdsLease(instanceId: string): Promise<boolean> {
  const db = await getDB()
  const lease = await db.get('leases', instanceId as any)
  
  if (!lease) return false
  if (lease.ownerId !== ownerId) return false
  if (lease.expiresAt < Date.now()) return false
  
  return true
}

/**
 * Start heartbeat timer for active leases
 */
export function startLeaseHeartbeat(activeInstances: Set<string>): () => void {
  const interval = setInterval(async () => {
    for (const instanceId of activeInstances) {
      try {
        const stillHeld = await heartbeatLease(instanceId)
        if (!stillHeld) {
          activeInstances.delete(instanceId)
        }
      } catch {
        activeInstances.delete(instanceId)
      }
    }
  }, HEARTBEAT_INTERVAL)
  
  return () => clearInterval(interval)
}