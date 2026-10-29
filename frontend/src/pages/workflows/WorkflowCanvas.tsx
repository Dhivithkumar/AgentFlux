// @ts-nocheck
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Settings, Play, Database, Box, Zap, GitBranch } from 'lucide-react';

const NODE_COLORS: Record<string, string> = {
  TRIGGER: 'border-blue-500 bg-blue-50 text-blue-900',
  AI_AGENT: 'border-purple-500 bg-purple-50 text-purple-900',
  ACTION: 'border-emerald-500 bg-emerald-50 text-emerald-900',
  CONDITION: 'border-amber-500 bg-amber-50 text-amber-900',
  RAG_SEARCH: 'border-indigo-500 bg-indigo-50 text-indigo-900',
  END: 'border-slate-500 bg-slate-50 text-slate-900'
};

const CustomNode = ({ data, isConnectable }: any) => {
  const colorClass = NODE_COLORS[data.type] || 'border-slate-300 bg-white text-slate-900';
  
  return (
    <div className={`px-4 py-3 shadow-md rounded-xl border-2 ${colorClass} min-w-[200px]`}>
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />
      
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 bg-white/50 rounded-lg">
          {data.type === 'TRIGGER' && <Zap size={16} />}
          {data.type === 'AI_AGENT' && <Box size={16} />}
          {data.type === 'CONDITION' && <GitBranch size={16} />}
          {data.type === 'RAG_SEARCH' && <Database size={16} />}
          {data.type === 'ACTION' && <Play size={16} />}
          {!['TRIGGER', 'AI_AGENT', 'CONDITION', 'RAG_SEARCH', 'ACTION'].includes(data.type) && <Settings size={16} />}
        </div>
        <div className="font-bold text-sm truncate">{data.label}</div>
      </div>
      
      <div className="text-xs opacity-75 truncate">{data.subtitle}</div>
      
      <Handle type="source" position={Position.Bottom} id="a" isConnectable={isConnectable} />
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

export function WorkflowCanvas({ nodes: initialRawNodes, onNodeSelect }: { nodes: any[], onNodeSelect: (node: any) => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    if (!initialRawNodes || !Array.isArray(initialRawNodes)) return;

    // Auto-layout logic (Simple vertical layout)
    const newNodes = initialRawNodes.map((node, index) => {
      // Find level (depth)
      return {
        id: node.id,
        type: 'custom',
        position: { x: 250, y: index * 150 },
        data: { 
          label: node.id,
          type: node.type,
          subtitle: node.config?.connector || node.config?.action || node.config?.task || node.type,
          raw: node
        }
      };
    });

    const newEdges: any[] = [];
    initialRawNodes.forEach((node) => {
      if (node.next) {
        Object.entries(node.next).forEach(([key, targetId]) => {
          newEdges.push({
            id: `e-${node.id}-${targetId}-${key}`,
            source: node.id,
            target: String(targetId),
            label: key !== 'DEFAULT' ? key : undefined,
            type: 'smoothstep',
            animated: true,
            markerEnd: {
              type: MarkerType.ArrowClosed,
            },
            style: { strokeWidth: 2 }
          });
        });
      }
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [initialRawNodes]);

  const onConnect = useCallback((params: any) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  return (
    <div className="w-full h-[600px] bg-slate-50/50 rounded-2xl border border-slate-200 shadow-inner overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onNodeSelect(node.data.raw)}
        fitView
        attributionPosition="bottom-left"
      >
        <Controls />
        <Background gap={16} size={1} color="#e2e8f0" />
      </ReactFlow>
    </div>
  );
}
