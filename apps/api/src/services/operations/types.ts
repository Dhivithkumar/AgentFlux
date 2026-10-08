export interface OperationalRow {
  id: string; // The stable identifier (e.g. Enquiry ID, Customer ID)
  data: Record<string, any>; // Column Name -> Value
}

export interface OperationalWorksheetSchema {
  name: string; // e.g., 'Enquiries', 'Customers', 'Followups'
  headers: string[]; // List of column headers
}

export interface OperationalAdapter {
  initialize(spreadsheetName: string, schemas: OperationalWorksheetSchema[]): Promise<{ spreadsheetId: string, sheetMappings: Record<string, string> }>;
  getSpreadsheetUrl(spreadsheetId: string): string;
  verifyAccess(spreadsheetId: string): Promise<boolean>;
  ensureWorksheetAndHeaders(spreadsheetId: string, schema: OperationalWorksheetSchema): Promise<string>;
  syncRecords(spreadsheetId: string, worksheetName: string, records: OperationalRow[]): Promise<void>;
}
