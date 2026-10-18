/// <reference types="chrome"/>
import type { BridgeActivityEvent } from './pageAgentBridge'

const MAX_BUFFER_SIZE = 1000

interface EventBusSubscription {
  instanceId?: string
  widgetId?: string
  listener: (event: BridgeActivityEvent) => void
}

/**
 * Central Service Worker Event Bus
 * Aggregates events from all active widget instances
 * Maintains rolling buffer for late connections
 * Supports filtered streaming
 */
class EventBus {
  private buffer: BridgeActivityEvent[] = []
  private subscriptions: Set<EventBusSubscription> = new Set()
  private ports: Set<chrome.runtime.Port> = new Set()

  constructor() {
    // Handle sidepanel connections
    chrome.runtime.onConnect.addListener(port => {
      if (port.name === 'widget-activity-stream') {
        this.attachPort(port)
      }
    })
  }

  /**
   * Publish an event to the bus
   */
  publish(event: BridgeActivityEvent): void {
    // Add to rolling buffer
    this.buffer.push(event)
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift()
    }

    // Notify local subscribers
    this.subscriptions.forEach(sub => {
      if (sub.instanceId && sub.instanceId !== event.instanceId) return
      if (sub.widgetId && sub.widgetId !== event.widgetId) return

      try {
        sub.listener(event)
      } catch {
        // Ignore listener errors
      }
    })

    // Broadcast to connected ports
    this.ports.forEach(port => {
      try {
        port.postMessage({
          type: 'activity_event',
          event
        })
      } catch {
        // Port may have disconnected
      }
    })
  }

  /**
   * Subscribe to events with optional filtering
   */
  subscribe(
    listener: (event: BridgeActivityEvent) => void,
    filters?: { instanceId?: string; widgetId?: string }
  ): () => void {
    const subscription: EventBusSubscription = {
      ...filters,
      listener
    }

    this.subscriptions.add(subscription)

    // Send buffered history
    this.buffer.forEach(event => {
      if (subscription.instanceId && subscription.instanceId !== event.instanceId) return
      if (subscription.widgetId && subscription.widgetId !== event.widgetId) return
      listener(event)
    })

    return () => this.subscriptions.delete(subscription)
  }

  /**
   * Attach a runtime port for streaming
   */
  private attachPort(port: chrome.runtime.Port): void {
    this.ports.add(port)

    // Send full history on connect
    port.postMessage({
      type: 'history_sync',
      events: this.buffer
    })

    // Cleanup on disconnect
    port.onDisconnect.addListener(() => {
      this.ports.delete(port)
    })
  }

  /**
   * Get buffered event history
   */
  getHistory(): BridgeActivityEvent[] {
    return [...this.buffer]
  }

  /**
   * Clear event buffer
   */
  clear(): void {
    this.buffer = []
  }
}

export const eventBus = new EventBus()