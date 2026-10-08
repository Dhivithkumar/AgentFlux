export interface OAuthTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number; // seconds
  tokenType?: string;
  scope?: string;
}

export interface ConnectorAccountInfo {
  accountId: string;
  accountEmail: string | null;
  displayName: string | null;
  metadata?: any;
}

export interface ConnectorProvider {
  providerId: string;
  
  getAuthorizationUrl(state: string, scopes: string[]): string;
  
  handleOAuthCallback(code: string): Promise<OAuthTokenResult>;
  
  refreshAccessToken(refreshToken: string): Promise<OAuthTokenResult>;
  
  getAccountInfo(accessToken: string): Promise<ConnectorAccountInfo>;
  
  verifyConnection(accessToken: string): Promise<boolean>;
  
  disconnect(accessToken: string): Promise<void>;

  getCapabilities(): string[];
}

export interface ConnectorExecutionContext {
  businessId: string;
  workflowId: string;
  executionId: string;
  accessToken: string;
}

export interface ConnectorAction {
  id: string;
  name: string;
  description: string;
  isWrite?: boolean;
  
  inputSchema: any;
  outputSchema: any;

  execute(
    context: ConnectorExecutionContext,
    input: unknown
  ): Promise<unknown>;
}

export interface ConnectorTrigger {
  id: string;
  name: string;
  eventSchema: any;

  subscribe?(): Promise<void>;
  unsubscribe?(): Promise<void>;
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  logo: string;
  defaultScopes: string[];
  status?: 'available' | 'coming_soon';
  capabilities?: string[];
  
  actions: ConnectorAction[];
  triggers: ConnectorTrigger[];
}
