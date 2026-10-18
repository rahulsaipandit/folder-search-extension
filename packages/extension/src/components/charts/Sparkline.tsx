import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts'
import '@/components/charts/vizTokens.css'
import { ChartTooltip } from './ChartTooltip'

export interface SparklinePoint {
	x: string
	y: number
}

/**
 * Minimal single-series inline trend chart for a small-multiples grid (one per keyword card).
 * No categorical color decision needed here - each sparkline is its own single-series chart, so
 * the all-pairs cap in palette.md (which governs *overlaying* several series in one chart) doesn't
 * apply; every sparkline safely reuses categorical slot 1.
 */
export function Sparkline({ data, invertY = false }: { data: SparklinePoint[]; invertY?: boolean }) {
	if (data.length < 2) {
		return <span className="text-xs" style={{ color: 'var(--viz-muted)' }}>Not enough history yet</span>
	}
	return (
		<div className="viz-root" style={{ height: 40, width: 120 }}>
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
					<YAxis hide reversed={invertY} domain={['dataMin - 1', 'dataMax + 1']} />
					<Tooltip content={<ChartTooltip />} />
					<Line
						type="monotone"
						dataKey="y"
						name="Position"
						stroke="var(--viz-series-1)"
						strokeWidth={2}
						dot={false}
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	)
}
