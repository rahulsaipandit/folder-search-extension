import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import '@/components/charts/vizTokens.css'
import { ChartTooltip } from './ChartTooltip'

export interface TrendPoint {
	x: string
	y: number
}

interface TrendLineChartProps {
	data: TrendPoint[]
	/** Legend/tooltip name for the single series. */
	name: string
	/** Formats the y-axis tick and tooltip value, e.g. `v => \`${v}%\`` for a rate. */
	formatValue?: (value: number) => string
	/** Reverses the y-axis so a "lower is better" metric (e.g. avg. search position) reads correctly. */
	invertY?: boolean
	height?: number
}

/**
 * Single-series change-over-time line chart. One axis only, per the dataviz skill's #1
 * anti-pattern - never overlay a second metric of a different scale on a second y-axis here;
 * render it as a separate TrendLineChart instead.
 */
export function TrendLineChart({
	data,
	name,
	formatValue = v => String(v),
	invertY = false,
	height = 220,
}: TrendLineChartProps) {
	if (data.length === 0) {
		return (
			<div
				className="viz-root flex items-center justify-center text-sm"
				style={{ height, color: 'var(--viz-muted)' }}
			>
				Not enough data yet.
			</div>
		)
	}

	return (
		<div className="viz-root" style={{ height }}>
			<ResponsiveContainer width="100%" height="100%">
				<LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
					<CartesianGrid stroke="var(--viz-grid)" vertical={false} />
					<XAxis
						dataKey="x"
						stroke="var(--viz-axis)"
						tick={{ fill: 'var(--viz-muted)', fontSize: 12 }}
						tickLine={false}
					/>
					<YAxis
						stroke="var(--viz-axis)"
						tick={{ fill: 'var(--viz-muted)', fontSize: 12 }}
						tickLine={false}
						tickFormatter={formatValue}
						reversed={invertY}
						width={44}
					/>
					<Tooltip content={<ChartTooltip />} />
					<Line
						type="monotone"
						dataKey="y"
						name={name}
						stroke="var(--viz-series-1)"
						strokeWidth={2}
						dot={{ r: 3, fill: 'var(--viz-series-1)' }}
						activeDot={{ r: 5 }}
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	)
}
