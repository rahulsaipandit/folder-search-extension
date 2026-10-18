import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import '@/components/charts/vizTokens.css'
import { ChartTooltip } from './ChartTooltip'

export interface SentimentDatum {
	positive: number
	negative: number
}

/**
 * Diverging bar around a neutral zero midpoint - sentiment is a polarity job, not a categorical
 * one, so this uses the diverging blue<->red pair (never a 3-way categorical rainbow for
 * positive/neutral/negative). Neutral count is reported separately by the caller, not plotted
 * here - there's no "neither direction" bar in a diverging chart, only the two poles.
 */
export function DivergingSentimentChart({ positive, negative }: SentimentDatum) {
	const data = [{ label: 'Brand mentions', positive, negative: -negative }]
	const max = Math.max(positive, negative, 1)

	return (
		<div className="viz-root" style={{ height: 100 }}>
			<ResponsiveContainer width="100%" height="100%">
				<BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
					<CartesianGrid stroke="var(--viz-grid)" horizontal={false} />
					<XAxis
						type="number"
						domain={[-max, max]}
						stroke="var(--viz-axis)"
						tick={{ fill: 'var(--viz-muted)', fontSize: 12 }}
						tickFormatter={v => String(Math.abs(v))}
						tickLine={false}
					/>
					<YAxis type="category" dataKey="label" hide />
					<ReferenceLine x={0} stroke="var(--viz-axis)" />
					<Tooltip content={<ChartTooltip />} formatter={value => Math.abs(Number(value))} />
					<Bar dataKey="negative" name="Negative" radius={[4, 0, 0, 4]}>
						<Cell fill="var(--viz-diverging-neg)" />
					</Bar>
					<Bar dataKey="positive" name="Positive" radius={[0, 4, 4, 0]}>
						<Cell fill="var(--viz-diverging-pos)" />
					</Bar>
				</BarChart>
			</ResponsiveContainer>
		</div>
	)
}
