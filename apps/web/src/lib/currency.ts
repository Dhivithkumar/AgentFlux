/**
 * Authoritative Indian Rupee (INR / ₹) currency formatting.
 * The project strictly uses INR with en-IN Lakhs and Crores grouping.
 */
export function formatCurrency(amount: number | null | undefined, _currency: string = 'INR'): string {
  const numeric = typeof amount === 'number' && !isNaN(amount) ? amount : (typeof amount === 'string' ? parseFloat(amount) || 0 : 0);

  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `₹${numeric.toLocaleString('en-IN')}`;
  }
}

