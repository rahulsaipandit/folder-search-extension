import { useEffect, useMemo, useRef, useState } from 'react'

import { computeForceLayout } from '../layout/force'
import type { GraphViewerData, LayoutNode } from '../types'

const VB_W = 800
const VB_H = 480

const TYPE_COLORS: Record<string, string> = {
	person: '#6366f1',
	organization: '#f59e0b',
	project: '#10b981',
	system: '#3b82f6',
	concept: '#8b5cf6',
	location: '#f97316',
	other: '#6b7280',
}

interface TooltipInfo {
	node: LayoutNode
	connections: Array<{ name: string; edgeType: string }>
	screenX: number
	screenY: number
}

interface GraphViewerProps {
	data: GraphViewerData
	height?: number
	className?: string
}

export function GraphViewer({ data, height = 480, className }: GraphViewerProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const svgRef = useRef<SVGSVGElement>(null)

	const [pan, setPan] = useState({ x: 0, y: 0 })
	const [zoom, setZoom] = useState(1)
	const [tooltip, setTooltip] = useState<TooltipInfo | null>(null)
	const [selected, setSelected] = useState<string | null>(null)
	const [isPanning, setIsPanning] = useState(false)

	const panRef = useRef({ x: 0, y: 0 })
	const zoomRef = useRef(1)
	const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 })
	const isOverNode = useRef(false)

	const nodes = useMemo(() => computeForceLayout(data, VB_W, VB_H), [data])
	const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

	const layoutEdges = useMemo(
		() =>
			data.edges
				.map((e) => ({ ...e, fromNode: nodeById.get(e.from), toNode: nodeById.get(e.to) }))
				.filter((e) => e.fromNode && e.toNode),
		[data.edges, nodeById]
	)

	const neighborIds = useMemo(() => {
		if (!selected) return null
		const ids = new Set<string>([selected])
		for (const e of data.edges) {
			if (e.from === selected) ids.add(e.to)
			if (e.to === selected) ids.add(e.from)
		}
		return ids
	}, [selected, data.edges])

	// SVG ↔ screen coordinate helpers
	const toSVGCoords = (clientX: number, clientY: number) => {
		const rect = svgRef.current!.getBoundingClientRect()
		return {
			x: ((clientX - rect.left) / rect.width) * VB_W,
			y: ((clientY - rect.top) / rect.height) * VB_H,
		}
	}

	// Wheel zoom (non-passive)
	useEffect(() => {
		const el = svgRef.current
		if (!el) return
		const handler = (e: WheelEvent) => {
			e.preventDefault()
			const svgPt = toSVGCoords(e.clientX, e.clientY)
			const factor = e.deltaY < 0 ? 1.12 : 0.9
			const oldZ = zoomRef.current
			const newZ = Math.max(0.25, Math.min(4, oldZ * factor))
			const newPx = svgPt.x - ((svgPt.x - panRef.current.x) * newZ) / oldZ
			const newPy = svgPt.y - ((svgPt.y - panRef.current.y) * newZ) / oldZ
			zoomRef.current = newZ
			panRef.current = { x: newPx, y: newPy }
			setZoom(newZ)
			setPan({ x: newPx, y: newPy })
		}
		el.addEventListener('wheel', handler, { passive: false })
		return () => el.removeEventListener('wheel', handler)
	}, [])

	const onSVGMouseDown = (e: React.MouseEvent) => {
		if (isOverNode.current) return
		setIsPanning(true)
		dragStart.current = {
			mx: e.clientX,
			my: e.clientY,
			px: panRef.current.x,
			py: panRef.current.y,
		}
	}

	const onSVGMouseMove = (e: React.MouseEvent) => {
		if (!isPanning) return
		const rect = svgRef.current!.getBoundingClientRect()
		const scaleX = VB_W / rect.width
		const scaleY = VB_H / rect.height
		const dx = (e.clientX - dragStart.current.mx) * scaleX
		const dy = (e.clientY - dragStart.current.my) * scaleY
		const newPan = { x: dragStart.current.px + dx, y: dragStart.current.py + dy }
		panRef.current = newPan
		setPan(newPan)
	}

	const stopPan = () => setIsPanning(false)

	const onNodeEnter = (e: React.MouseEvent, node: LayoutNode) => {
		isOverNode.current = true
		const rect = containerRef.current!.getBoundingClientRect()
		const connections = data.edges
			.filter((ed) => ed.from === node.id || ed.to === node.id)
			.map((ed) => {
				const otherId = ed.from === node.id ? ed.to : ed.from
				const other = nodeById.get(otherId)
				return other ? { name: other.name, edgeType: ed.type } : null
			})
			.filter(Boolean) as Array<{ name: string; edgeType: string }>

		setTooltip({
			node,
			connections,
			screenX: e.clientX - rect.left,
			screenY: e.clientY - rect.top,
		})
	}

	const onNodeLeave = () => {
		isOverNode.current = false
		setTooltip(null)
	}

	const onNodeClick = (id: string) => {
		setSelected((s) => (s === id ? null : id))
	}

	if (nodes.length === 0) {
		return (
			<div
				style={{
					width: '100%',
					height,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					background: 'var(--twin-surface, #0f0f0f)',
					borderRadius: 12,
					border: '1px solid var(--twin-border, #1e293b)',
					color: 'var(--twin-muted, #94a3b8)',
					fontSize: 13,
				}}
			>
				No graph data
			</div>
		)
	}

	return (
		<div ref={containerRef} className={className} style={{ position: 'relative', width: '100%' }}>
			<svg
				ref={svgRef}
				viewBox={`0 0 ${VB_W} ${VB_H}`}
				style={{
					width: '100%',
					height,
					display: 'block',
					cursor: isPanning ? 'grabbing' : 'grab',
					background: 'var(--twin-surface, #0c1120)',
					borderRadius: 12,
					border: '1px solid var(--twin-border, #1e293b)',
				}}
				onMouseDown={onSVGMouseDown}
				onMouseMove={onSVGMouseMove}
				onMouseUp={stopPan}
				onMouseLeave={stopPan}
			>
				<defs>
					<filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
						<feGaussianBlur stdDeviation="3" result="blur" />
						<feMerge>
							<feMergeNode in="blur" />
							<feMergeNode in="SourceGraphic" />
						</feMerge>
					</filter>
				</defs>

				<g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
					{/* Edges */}
					{layoutEdges.map((e, i) => {
						const fn = e.fromNode!
						const tn = e.toNode!
						const dx = tn.x - fn.x
						const dy = tn.y - fn.y
						const dist = Math.sqrt(dx * dx + dy * dy) || 1
						// Offset endpoints to node surface
						const x1 = fn.x + (dx / dist) * (fn.radius + 2)
						const y1 = fn.y + (dy / dist) * (fn.radius + 2)
						const x2 = tn.x - (dx / dist) * (tn.radius + 2)
						const y2 = tn.y - (dy / dist) * (tn.radius + 2)
						const active =
							!neighborIds || (neighborIds.has(e.from) && neighborIds.has(e.to))
						return (
							<line
								key={i}
								x1={x1}
								y1={y1}
								x2={x2}
								y2={y2}
								stroke="#334155"
								strokeWidth={Math.max(0.8, e.weight * 1.8)}
								strokeOpacity={active ? 0.7 : 0.1}
								style={{ transition: 'stroke-opacity 0.2s' }}
							/>
						)
					})}

					{/* Nodes */}
					{nodes.map((node) => {
						const color = TYPE_COLORS[node.type] ?? '#6b7280'
						const isHovered = tooltip?.node.id === node.id
						const isSelected = node.id === selected
						const active = !neighborIds || neighborIds.has(node.id)
						const r = node.radius

						return (
							<g
								key={node.id}
								transform={`translate(${node.x},${node.y})`}
								style={{ cursor: 'pointer' }}
								onMouseEnter={(e) => onNodeEnter(e, node)}
								onMouseLeave={onNodeLeave}
								onClick={() => onNodeClick(node.id)}
							>
								{isSelected && (
									<circle r={r + 7} fill={color} opacity={0.18} filter="url(#glow)" />
								)}
								<circle
									r={r}
									fill={color}
									opacity={active ? (isHovered || isSelected ? 1 : 0.82) : 0.15}
									style={{ transition: 'opacity 0.2s' }}
								/>
								{/* Inner highlight */}
								<circle r={r * 0.42} fill="rgba(255,255,255,0.18)" cy={-r * 0.25} />
								<text
									y={r + 13}
									textAnchor="middle"
									fontSize={9}
									fill={active ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.15)'}
									style={{ pointerEvents: 'none', userSelect: 'none' }}
								>
									{node.name.length > 18 ? node.name.slice(0, 17) + '…' : node.name}
								</text>
							</g>
						)
					})}
				</g>

				{/* Legend - fixed in SVG viewport, outside transform group */}
				<g transform="translate(14, 14)">
					{Object.entries(TYPE_COLORS).map(([type, color], i) => (
						<g key={type} transform={`translate(0,${i * 15})`}>
							<circle r={4} cx={4} cy={4} fill={color} opacity={0.85} />
							<text x={13} y={8} fontSize={8} fill="rgba(255,255,255,0.45)">
								{type}
							</text>
						</g>
					))}
				</g>

				{/* Node count */}
				<text
					x={VB_W - 10}
					y={VB_H - 10}
					textAnchor="end"
					fontSize={8}
					fill="rgba(255,255,255,0.25)"
				>
					{nodes.length} nodes · {layoutEdges.length} edges · scroll to zoom · drag to pan
				</text>
			</svg>

			{/* Floating tooltip - rendered as HTML over the SVG */}
			{tooltip && (
				<div
					style={{
						position: 'absolute',
						left: Math.min(tooltip.screenX + 14, (containerRef.current?.offsetWidth ?? 500) - 200),
						top: Math.max(8, tooltip.screenY - 60),
						background: '#0f172a',
						border: '1px solid #1e293b',
						borderRadius: 8,
						padding: '10px 14px',
						pointerEvents: 'none',
						zIndex: 20,
						minWidth: 160,
						maxWidth: 220,
						boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
					}}
				>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 8,
							marginBottom: 6,
						}}
					>
						<div
							style={{
								width: 8,
								height: 8,
								borderRadius: '50%',
								background: TYPE_COLORS[tooltip.node.type] ?? '#6b7280',
								flexShrink: 0,
							}}
						/>
						<span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>
							{tooltip.node.name}
						</span>
					</div>
					<div style={{ fontSize: 11, color: '#64748b', marginBottom: tooltip.connections.length > 0 ? 6 : 0 }}>
						{tooltip.node.type} · {tooltip.node.degree} connection
						{tooltip.node.degree !== 1 ? 's' : ''}
					</div>
					{tooltip.connections.slice(0, 4).map((c, i) => (
						<div key={i} style={{ fontSize: 10, color: '#475569', lineHeight: 1.6 }}>
							<span style={{ color: '#334155' }}>→</span> {c.name}{' '}
							<span style={{ color: '#1e3a5f', fontSize: 9 }}>({c.edgeType})</span>
						</div>
					))}
					{tooltip.connections.length > 4 && (
						<div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>
							+{tooltip.connections.length - 4} more
						</div>
					)}
				</div>
			)}
		</div>
	)
}
