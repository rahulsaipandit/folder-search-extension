import type { WikiKnowledgeBaseConfig } from '../../types'

export class WikiEdgeWeights {
	private config: WikiKnowledgeBaseConfig
	constructor(config: WikiKnowledgeBaseConfig) { this.config = config }

	calculateStructuralWeight(wikilinkCount: number, sharedSourceCount: number, adamicAdarScore: number, isSameWeek: boolean): number {
		const { wikilinkWeight, sharedSourceWeight, adamicAdarWeight, temporalWeight } = this.config.edgeWeightTuning
		return wikilinkCount * wikilinkWeight +
			Math.min(1.0, sharedSourceCount / 3) * sharedSourceWeight +
			adamicAdarScore * adamicAdarWeight +
			(isSameWeek ? temporalWeight : 0)
	}

	async calculateAdamicAdar(commonNeighbors: string[], getOutDegree: (nodeId: string) => Promise<number>): Promise<number> {
		let score = 0
		for (const n of commonNeighbors) {
			const deg = await getOutDegree(n)
			if (deg > 1) score += 1 / Math.log(deg)
		}
		return score
	}

	isSameWeek(t1: number, t2: number): boolean {
		return Math.abs(t1 - t2) < 7 * 24 * 60 * 60 * 1000
	}
}
