import type { TooltipContentProps } from 'recharts'

/**
 * Shared recharts tooltip styled from the viz token set (vizTokens.css) instead of recharts'
 * default theme - per dataviz skill's interaction.md, every line/area/bar chart ships a hover
 * tooltip by default, not just on request.
 */
export function ChartTooltip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
	if (!active || !payload?.length) return null
	return (
		<div
			style={{
				background: 'var(--viz-surface)',
				border: '1px solid var(--viz-grid)',
				borderRadius: 8,
				padding: '8px 12px',
				fontSize: 13,
				color: 'var(--viz-text-primary)',
				boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
			}}
		>
			{label != null && (
				<div style={{ color: 'var(--viz-text-secondary)', marginBottom: 4 }}>{label}</div>
			)}
			{payload.map((entry: NonNullable<TooltipContentProps<number, string>['payload']>[number]) => (
				<div key={entry.dataKey as string} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
					<span
						style={{
							display: 'inline-block',
							width: 8,
							height: 8,
							borderRadius: 4,
							background: entry.color,
						}}
					/>
					<span style={{ color: 'var(--viz-text-secondary)' }}>{entry.name}:</span>
					<strong>{entry.value}</strong>
				</div>
			))}
		</div>
	)
}
