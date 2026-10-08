export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Business {
  id: string;
  name: string;
  industry: string;
  website: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export enum Role {
  OWNER = 'OWNER',
  MEMBER = 'MEMBER'
}

export interface Membership {
  id: string;
  userId: string;
  businessId: string;
  role: Role;
  createdAt: Date;
}

export enum IntegrationStatus {
  CONNECTED = "CONNECTED",
  DISCONNECTED = "DISCONNECTED",
  RECONNECT_REQUIRED = "RECONNECT_REQUIRED",
  ERROR = "ERROR"
}

export interface Integration {
  id: string;
  businessId: string;
  provider: string;
  accountId: string;
  accountEmail: string | null;
  displayName: string | null;
  status: IntegrationStatus;
  scopes: string[];
  metadata: any | null;
  createdAt: Date;
  updatedAt: Date;
  lastConnectedAt: Date | null;
  lastVerifiedAt: Date | null;
}