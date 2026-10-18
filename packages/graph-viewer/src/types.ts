export type EntityType =
	| 'person'
	| 'organization'
	| 'project'
	| 'system'
	| 'concept'
	| 'location'
	| 'other'

export interface ViewEntity {
	id: string
	name: string
	type: EntityType
}

export interface ViewEdge {
	from: string
	to: string
	type: string
	weight: number
}

export interface GraphViewerData {
	entities: ViewEntity[]
	edges: ViewEdge[]
}

export interface LayoutNode extends ViewEntity {
	x: number
	y: number
	radius: number
	degree: number
}
