import { getDB } from './db'

interface PerformanceMetrics {
  operation: string
  duration: number
  timestamp: number
  success: boolean
  metadata?: Record<string, any>
}

class MetricsCollector {
  private metrics: PerformanceMetrics[] = []
  private maxMetrics = 1000

  record(operation: string, duration: number, success: boolean, metadata?: Record<string, any>) {
    const metric: PerformanceMetrics = {
      operation,
      duration,
      timestamp: Date.now(),
      success,
      metadata
    }

    this.metrics.push(metric)

    // Keep only recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics)
    }

    // TODO: Persist to IndexedDB for long-term storage
    console.log(`[Metrics] ${operation}: ${duration}ms (${success ? 'success' : 'failed'})`)
  }

  getMetrics(operation?: string, timeRange?: number): PerformanceMetrics[] {
    let filtered = this.metrics

    if (operation) {
      filtered = filtered.filter(m => m.operation === operation)
    }

    if (timeRange) {
      const cutoff = Date.now() - timeRange
      filtered = filtered.filter(m => m.timestamp >= cutoff)
    }

    return filtered
  }

  getStats(operation?: string, timeRange?: number) {
    const metrics = this.getMetrics(operation, timeRange)

    if (metrics.length === 0) {
      return { count: 0, avgDuration: 0, successRate: 0 }
    }

    const totalDuration = metrics.reduce((sum, m) => sum + m.duration, 0)
    const successCount = metrics.filter(m => m.success).length

    return {
      count: metrics.length,
      avgDuration: totalDuration / metrics.length,
      successRate: successCount / metrics.length
    }
  }
}

export const metrics = new MetricsCollector()

// Helper function to measure operation performance
export function measurePerformance<T>(
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, any>
): Promise<T> {
  const start = performance.now()

  return fn()
    .then(result => {
      const duration = performance.now() - start
      metrics.record(operation, duration, true, metadata)
      return result
    })
    .catch(error => {
      const duration = performance.now() - start
      metrics.record(operation, duration, false, { ...metadata, error: error.message })
      throw error
    })
}