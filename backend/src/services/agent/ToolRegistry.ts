export interface ToolConfig {
  name: string;
  description: string;
  inputSchema: any;
  outputSchema?: any;
  category: string;
  riskLevel: string;
  requiredPermissions: string[];
  requiredConnector?: string;
  supportsIdempotency?: boolean;
  supportsDryRun?: boolean;
  execute: (context: any, input: any) => Promise<any>;
}

export class ToolRegistry {
  private static tools: Map<string, ToolConfig> = new Map();

  static register(tool: ToolConfig) {
    this.tools.set(tool.name, tool);
  }

  static get(name: string): ToolConfig | undefined {
    return this.tools.get(name);
  }

  static getAll(): ToolConfig[] {
    return Array.from(this.tools.values());
  }

  static getAllowedTools(permissions: any[]): ToolConfig[] {
    // Only tools that are ALLOWED or REQUIRES_APPROVAL
    const allowedNames = permissions
       .filter(p => p.permission === 'ALLOW' || p.permission === 'REQUIRES_APPROVAL')
       .map(p => p.toolName);
       
    return this.getAll().filter(t => allowedNames.includes(t.name));
  }
}
