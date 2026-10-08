import { CONNECTORS } from './registry';
import { ConnectorDefinition } from './types';

export interface CapabilityDefinition {
  id: string; // e.g., 'EMAIL.SEND'
  description: string;
  category: string;
}

export const CAPABILITIES: CapabilityDefinition[] = [
  { id: 'EMAIL.READ', description: 'Read emails', category: 'EMAIL' },
  { id: 'EMAIL.SEARCH', description: 'Search emails', category: 'EMAIL' },
  { id: 'EMAIL.SEND', description: 'Send emails', category: 'EMAIL' },
  { id: 'EMAIL.REPLY', description: 'Reply to emails', category: 'EMAIL' },
  
  { id: 'CALENDAR.CREATE_EVENT', description: 'Create calendar event', category: 'CALENDAR' },
  { id: 'CALENDAR.READ_EVENT', description: 'Read calendar event', category: 'CALENDAR' },
  { id: 'CALENDAR.LIST_EVENTS', description: 'List calendar events', category: 'CALENDAR' },
  { id: 'CALENDAR.CHECK_AVAILABILITY', description: 'Check availability', category: 'CALENDAR' },
  
  { id: 'CRM.CREATE_LEAD', description: 'Create CRM lead', category: 'CRM' },
  { id: 'CRM.SEARCH_CONTACT', description: 'Search CRM contacts', category: 'CRM' },
  { id: 'CRM.UPDATE_CONTACT', description: 'Update CRM contact', category: 'CRM' },
  
  { id: 'ECOMMERCE.READ_ORDER', description: 'Read order details', category: 'ECOMMERCE' },
];

/**
 * Returns a list of connectors that support the given capability ID.
 * This is used to dynamically resolve which connected accounts can satisfy a workflow's needs.
 */
export function getConnectorsForCapability(capabilityId: string): ConnectorDefinition[] {
  return CONNECTORS.filter(c => c.capabilities?.includes(capabilityId));
}

/**
 * Returns true if a given connector supports a specific capability.
 */
export function connectorSupportsCapability(connectorId: string, capabilityId: string): boolean {
  const connector = CONNECTORS.find(c => c.id === connectorId);
  if (!connector) return false;
  return connector.capabilities?.includes(capabilityId) ?? false;
}
