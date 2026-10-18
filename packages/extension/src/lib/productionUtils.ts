// Production performance monitoring utilities
export const performanceMonitor = {
	// Track extension startup time
	markStartup: () => {
		if (__PRODUCTION__) {
			performance.mark('extension-startup')
		}
	},

	// Measure operation duration
	measureOperation: (name: string, operation: () => void | Promise<void>) => {
		if (!__PRODUCTION__) {
			return operation()
		}

		const startMark = `${name}-start`
		const endMark = `${name}-end`
		const measureName = `${name}-duration`

		performance.mark(startMark)

		try {
			const result = operation()
			if (result instanceof Promise) {
				return result.finally(() => {
					performance.mark(endMark)
					performance.measure(measureName, startMark, endMark)
				})
			} else {
				performance.mark(endMark)
				performance.measure(measureName, startMark, endMark)
				return result
			}
		} catch (error) {
			performance.mark(endMark)
			performance.measure(measureName, startMark, endMark)
			throw error
		}
	},

	// Get performance metrics (for debugging)
	getMetrics: () => {
		if (__PRODUCTION__) {
			const measures = performance.getEntriesByType('measure')
			return measures.map(measure => ({
				name: measure.name,
				duration: measure.duration,
			}))
		}
		return []
	},

	// Memory usage monitoring
	getMemoryUsage: () => {
		if (!__PRODUCTION__ && 'memory' in performance) {
			const memory = (performance as any).memory
			return {
				used: Math.round(memory.usedJSHeapSize / 1024 / 1024),
				total: Math.round(memory.totalJSHeapSize / 1024 / 1024),
				limit: Math.round(memory.jsHeapSizeLimit / 1024 / 1024),
			}
		}
		return null
	},
}

// Production error reporting (extend this with actual service)
export const errorReporter = {
	report: (error: Error, context?: Record<string, any>) => {
		if (__PRODUCTION__) {
			// In production, send to error reporting service
			console.error('Production Error:', error, context)

			// Example: Send to error reporting service
			// fetch('https://error-reporting-service.com/api/errors', {
			//   method: 'POST',
			//   body: JSON.stringify({
			//     error: error.message,
			//     stack: error.stack,
			//     context,
			//     version: __EXT_VERSION__,
			//     userAgent: navigator.userAgent,
			//   }),
			// }).catch(() => {
			//   // Silently fail if error reporting fails
			// })
		} else {
			console.error('Development Error:', error, context)
		}
	},

	wrap: <T extends (...args: any[]) => any>(fn: T, context?: string): T => {
		return ((...args: any[]) => {
			try {
				return fn(...args)
			} catch (error) {
				errorReporter.report(error as Error, { context, args })
				throw error
			}
		}) as T
	},
}