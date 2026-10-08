import { prisma } from '@agent-flux/database';

export interface CustomerResolutionParams {
  businessId: string;
  name?: string;
  email?: string;
  phone?: string;
  externalId?: string;
  source?: string;
}

export class CustomerResolutionService {
  async resolveCustomer(params: CustomerResolutionParams) {
    const { businessId, name, email, phone, externalId, source } = params;

    // Build the query to find an existing customer in this business context ONLY
    const OR = [];
    if (externalId) OR.push({ externalId });
    if (phone) OR.push({ phone });
    if (email) OR.push({ email });

    if (OR.length > 0) {
      const existingCustomers = await prisma.customer.findMany({
        where: {
          businessId,
          OR
        }
      });

      // Deduplication: if we confidently match exactly one, use it.
      // Prioritize verified externalId, then phone, then email.
      if (existingCustomers.length === 1) {
        return existingCustomers[0];
      }

      if (existingCustomers.length > 1) {
        // We have multiple matches. Try to find the best match or return the first for now.
        // In a real system, we might flag for manual merge, but for Phase 2 we use the strongest identifier.
        const byExternal = existingCustomers.find(c => c.externalId === externalId);
        if (byExternal) return byExternal;
        const byPhone = existingCustomers.find(c => c.phone === phone);
        if (byPhone) return byPhone;
        return existingCustomers[0];
      }
    }

    // No confident match, create a new customer
    const newCustomer = await prisma.customer.create({
      data: {
        businessId,
        name: name || null,
        email: email || null,
        phone: phone || null,
        externalId: externalId || null,
        source: source || 'UNKNOWN'
      }
    });

    return newCustomer;
  }
}

export const customerResolutionService = new CustomerResolutionService();
