/**
 * Quotes a worksheet name for valid Google Sheets A1 range notation.
 * Escapes any single quotes inside the title by doubling them ('').
 */
export function quoteSheetName(sheetName: string): string {
  if (!sheetName) return "''";
  let clean = sheetName.trim();
  // Strip outer quotes if already provided
  if (clean.startsWith("'") && clean.endsWith("'") && clean.length > 1) {
    clean = clean.slice(1, -1).replace(/''/g, "'");
  }
  const escaped = clean.replace(/'/g, "''");
  return `'${escaped}'`;
}

/**
 * Builds a properly quoted A1 range.
 * e.g. formatA1Range("Enquiries", "A1:Z") -> "'Enquiries'!A1:Z"
 * e.g. formatA1Range("Customer's Orders", "A1") -> "'Customer''s Orders'!A1"
 */
export function formatA1Range(sheetName: string, range: string): string {
  return `${quoteSheetName(sheetName)}!${range}`;
}

/**
 * Normalises a header string by trimming whitespace and lowercasing for case-insensitive matching.
 */
export function normalizeHeader(header: string): string {
  return (header || '').trim().toLowerCase();
}

/**
 * Normalises and deduplicates a list of schema headers while preserving the first appearance order.
 */
export function deduplicateHeaders(headers: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const h of headers) {
    const trimmed = (h || '').trim();
    if (!trimmed) continue;
    const norm = trimmed.toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * In-memory concurrency lock to serialize operations on the same key (e.g. spreadsheetId + worksheetName).
 */
export class AsyncLock {
  private locks = new Map<string, Promise<void>>();

  async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }

    let release: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, lockPromise);

    try {
      return await fn();
    } finally {
      this.locks.delete(key);
      release!();
    }
  }
}

export const sheetLock = new AsyncLock();
