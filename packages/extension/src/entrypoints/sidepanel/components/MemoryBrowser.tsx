// ===================================================================
// Page Agent Extension - Memory Browser Component
// ===================================================================
// Interactive knowledge graph visualization using graphology + sigma.js
// Displays the memory system's graph with force-directed layout and exploration tools
// ===================================================================

import React, { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Loader2, Search, RotateCcw, CornerUpLeft, Zap } from 'lucide-react'
import type { CanonicalNode, ScoredGraphEdge } from '@/memory/types'

// Graph data fetching hook
function useGraphData() {
  const [data, setData] = useState<{
    nodes: any[]
    edges: any[]
    stats: any
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'getGraphData' }, (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
          } else if (result.error) {
            reject(new Error(result.error))
          } else {
            resolve(result)
          }
        })
      })

      setData(response as any)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  return { data, loading, error, refetch: fetchData }
}

// Simple graph visualization component using existing GraphNode/GraphEdge data
function GraphVisualization({
  nodes,
  edges,
  onNodeClick
}: {
  nodes: any[]
  edges: any[]
  onNodeClick?: (node: any) => void
}) {
  const [selectedNode, setSelectedNode] = useState<any | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const filteredNodes = nodes.filter(node =>
    node.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    node.kind?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="flex h-full">
      {/* Graph Canvas */}
      <div className="flex-1 bg-slate-50 dark:bg-slate-900 rounded-lg border p-4">
        <div className="flex items-center gap-2 mb-4">
          <Search className="w-4 h-4" />
          <Input
            placeholder="Search nodes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1"
          />
        </div>

        {/* Node Grid (simplified visualization) */}
        <div className="grid grid-cols-4 gap-2 overflow-auto max-h-96">
          {filteredNodes.slice(0, 20).map((node) => (
            <div
              key={node.id}
              className={`
                p-2 rounded border cursor-pointer transition-colors
                ${selectedNode?.id === node.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                  : 'border-gray-200 hover:border-gray-300'
                }
              `}
              onClick={() => {
                setSelectedNode(node)
                onNodeClick?.(node)
              }}
            >
              <div className="text-xs font-medium truncate">{node.title}</div>
              <Badge variant="secondary" className="text-xs mt-1">
                {node.kind}
              </Badge>
            </div>
          ))}
        </div>

        {filteredNodes.length > 20 && (
          <div className="text-center text-sm text-gray-500 mt-2">
            Showing first 20 of {filteredNodes.length} nodes
          </div>
        )}
      </div>

      {/* Node Details Panel */}
      {selectedNode && (
        <div className="w-80 ml-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{selectedNode.title}</CardTitle>
              <Badge>{selectedNode.kind}</Badge>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div>
                  <label className="text-sm font-medium">ID:</label>
                  <div className="text-xs font-mono bg-gray-100 dark:bg-gray-800 p-1 rounded mt-1">
                    {selectedNode.id}
                  </div>
                </div>

                {selectedNode.content && (
                  <div>
                    <label className="text-sm font-medium">Content:</label>
                    <div className="text-sm mt-1 max-h-32 overflow-y-auto">
                      {selectedNode.content}
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium">Sources:</label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedNode.sourceIds?.map((source: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {source}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Tags:</label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedNode.tags?.map((tag: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-gray-500">
                  Created: {new Date(selectedNode.createdAt).toLocaleDateString()}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default function MemoryBrowser({ onBack }: { onBack?: () => void }) {
  const { data, loading, error, refetch } = useGraphData()
  const [selectedNode, setSelectedNode] = useState<CanonicalNode | null>(null)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin mr-2" />
        <span>Loading knowledge graph...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="text-red-500 mb-4">Failed to load graph data</div>
        <div className="text-sm text-gray-500 mb-4">{error}</div>
        <Button onClick={refetch} variant="outline">
          <RotateCcw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">No graph data available</div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-3 py-2 mb-4">
        <div className="flex items-center gap-2">
          <Zap className="size-5" />
          <div>
            <h1 className="text-lg font-medium">Knowledge Graph</h1>
            <p className="text-xs text-muted-foreground">
              {data.stats?.graph?.nodes || 0} nodes, {data.stats?.graph?.edges || 0} edges
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={refetch} variant="outline" size="sm">
            <RotateCcw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          {onBack && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onBack}
              className="cursor-pointer"
            >
              <CornerUpLeft className="size-3.5" />
            </Button>
          )}
        </div>
      </header>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Graph Composition</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              <div>Nodes: {data.stats?.graph?.nodes || 0}</div>
              <div>Edges: {data.stats?.graph?.edges || 0}</div>
              <div>Communities: {data.stats?.graph?.communities || 0}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Memory Layers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              <div>Working: {data.stats?.workingMemory?.count || 0}</div>
              <div>Semantic: {data.stats?.semantic?.entityCount || 0}</div>
              <div>Episodic: {data.stats?.episodic?.total || 0}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Graph Visualization */}
      <GraphVisualization
        nodes={data.nodes}
        edges={data.edges}
        onNodeClick={setSelectedNode}
      />
    </div>
  )
}