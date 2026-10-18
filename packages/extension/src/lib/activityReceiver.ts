/// <reference types="chrome"/>
import type { BridgeActivityEvent } from './pageAgentBridge'

type ActivityStreamListener = (event: BridgeActivityEvent) => void
type ConnectionStatusListener = (connected: boolean) => void

/**
 * Sidepanel Event Receiver
 * Persistent port connection with auto-reconnect
 * Handles state resync on reconnection
 */
class ActivityStreamReceiver {
  private port: chrome.runtime.Port | null = null
  private listeners: Set<ActivityStreamListener> = new Set()
  private connectionListeners: Set<ConnectionStatusListener> = new Set()
  private reconnectTimer: number | null = null
  private isConnected = false
  private reconnectDelay = 1000

  /**
   * Start connecting to service worker event stream
   */
  connect(): void {
    if (this.port) return

    try {
      this.port = chrome.runtime.connect({
        name: 'widget-activity-stream'
      })

      this.port.onMessage.addListener(this.handleMessage.bind(this))
      this.port.onDisconnect.addListener(this.handleDisconnect.bind(this))

      this.isConnected = true
      this.connectionListeners.forEach(listener => listener(true))
      this.reconnectDelay = 1000
    } catch (error) {
      console.warn('Failed to connect to activity stream, retrying...', error)
      this.scheduleReconnect()
    }
  }

  /**
   * Disconnect and stop auto-reconnect
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.port) {
      this.port.disconnect()
      this.port = null
    }

    this.isConnected = false
    this.connectionListeners.forEach(listener => listener(false))
  }

  /**
   * Subscribe to activity events
   */
  subscribe(listener: ActivityStreamListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Listen to connection status changes
   */
  onConnectionStatus(listener: ConnectionStatusListener): () => void {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }

  /**
   * Check if currently connected
   */
  get connected(): boolean {
    return this.isConnected
  }

  private handleMessage(message: any): void {
    if (message.type === 'activity_event') {
      this.listeners.forEach(listener => {
        try {
          listener(message.event)
        } catch {
          // Ignore listener errors
        }
      })
    } else if (message.type === 'history_sync') {
      // Resync full history on connection
      message.events.forEach((event: BridgeActivityEvent) => {
        this.listeners.forEach(listener => {
          try {
            listener(event)
          } catch {
            // Ignore listener errors
          }
        })
      })
    }
  }

  private handleDisconnect(): void {
    this.port = null
    this.isConnected = false
    this.connectionListeners.forEach(listener => listener(false))
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)

    // Exponential backoff with 30s max
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
  }
}

export const activityReceiver = new ActivityStreamReceiver()