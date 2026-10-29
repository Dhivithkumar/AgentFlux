import { prisma, PeriodStatus, Prisma } from '@agent-flux/database';

export interface CreatePeriodDTO {
  name: string;
  startDate: Date;
  endDate: Date;
}

export class PeriodService {
  /**
   * Retrieves all accounting periods for a business, sorted chronologically.
   */
  async getPeriods(businessId: string, status?: PeriodStatus) {
    return prisma.accountingPeriod.findMany({
      where: {
        businessId,
        ...(status ? { status } : {})
      },
      orderBy: { startDate: 'desc' },
      include: {
        _count: {
          select: { entries: true }
        }
      }
    });
  }

  /**
   * Retrieves an accounting period by its unique identifier.
   */
  async getPeriodById(businessId: string, periodId: string) {
    return prisma.accountingPeriod.findFirst({
      where: { id: periodId, businessId },
      include: {
        balances: {
          include: { account: true }
        },
        _count: {
          select: { entries: true }
        }
      }
    });
  }

  /**
   * Finds or automatically creates an OPEN accounting period covering the given date.
   * Throws an error if the period covering the date is LOCKED or CLOSED.
   */
  async getOrCreateOpenPeriodForDate(businessId: string, targetDate: Date): Promise<any> {
    const date = new Date(targetDate);

    // Check if an existing period covers this date
    const existing = await prisma.accountingPeriod.findFirst({
      where: {
        businessId,
        startDate: { lte: date },
        endDate: { gte: date }
      }
    });

    if (existing) {
      if (existing.status === 'LOCKED') {
        throw new Error(
          `PERIOD_LOCKED: Accounting period '${existing.name}' covering date ${date.toISOString().slice(0, 10)} is LOCKED. Entries cannot be posted.`
        );
      }
      if (existing.status === 'CLOSED') {
        throw new Error(
          `PERIOD_CLOSED: Accounting period '${existing.name}' covering date ${date.toISOString().slice(0, 10)} is CLOSED. Entries cannot be posted.`
        );
      }
      return existing;
    }

    // If no period exists, auto-create a standard monthly accounting period
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth(); // 0-indexed
    const monthStr = String(month + 1).padStart(2, '0');
    const periodName = `${year}-${monthStr}`;

    const startDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    // End date: last millisecond of the month
    const endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

    try {
      return await prisma.accountingPeriod.upsert({
        where: {
          businessId_name: {
            businessId,
            name: periodName
          }
        },
        update: {},
        create: {
          businessId,
          name: periodName,
          startDate,
          endDate,
          status: 'OPEN'
        }
      });
    } catch (err: any) {
      // In case of concurrent creation, retrieve the existing one
      const fallback = await prisma.accountingPeriod.findFirst({
        where: { businessId, name: periodName }
      });
      if (fallback) return fallback;
      throw err;
    }
  }

  /**
   * Locks an open accounting period, preventing new postings while allowing review.
   */
  async lockPeriod(businessId: string, periodId: string, userId?: string) {
    const period = await prisma.accountingPeriod.findFirst({
      where: { id: periodId, businessId }
    });

    if (!period) {
      throw new Error(`Period ${periodId} not found`);
    }

    if (period.status === 'CLOSED') {
      throw new Error(`Cannot lock period '${period.name}': it is already CLOSED`);
    }

    const updated = await prisma.accountingPeriod.update({
      where: { id: periodId },
      data: { status: 'LOCKED' }
    });

    await prisma.financeAuditLog.create({
      data: {
        businessId,
        userId,
        action: 'PERIOD_LOCKED',
        details: { periodId, periodName: period.name }
      }
    });

    return updated;
  }

  /**
   * Closes an accounting period after validating that no unposted DRAFT entries remain.
   * Snapshots opening, net, and closing balances for all active accounts.
   */
  async closePeriod(businessId: string, periodId: string, userId?: string) {
    const period = await prisma.accountingPeriod.findFirst({
      where: { id: periodId, businessId }
    });

    if (!period) {
      throw new Error(`Period ${periodId} not found`);
    }

    if (period.status === 'CLOSED') {
      throw new Error(`Period '${period.name}' is already CLOSED`);
    }

    // Check for draft journal entries in this period
    const draftCount = await prisma.journalEntry.count({
      where: {
        businessId,
        accountingPeriodId: periodId,
        status: 'DRAFT'
      }
    });

    if (draftCount > 0) {
      throw new Error(
        `CANNOT_CLOSE_PERIOD: Period '${period.name}' has ${draftCount} DRAFT journal entries. All entries must be posted or voided before closing.`
      );
    }

    // Snapshot account balances for this period
    const accounts = await prisma.account.findMany({
      where: { businessId, isActive: true },
      include: {
        journalLines: {
          where: {
            journalEntry: {
              accountingPeriodId: periodId,
              status: 'POSTED'
            }
          }
        }
      }
    });

    // Find prior closed period balances to calculate cumulative opening balances
    const priorPeriod = await prisma.accountingPeriod.findFirst({
      where: {
        businessId,
        endDate: { lt: period.startDate },
        status: 'CLOSED'
      },
      orderBy: { endDate: 'desc' },
      include: { balances: true }
    });

    const priorBalancesByAccount = new Map<string, { closingDebit: Prisma.Decimal; closingCredit: Prisma.Decimal }>();
    if (priorPeriod) {
      for (const b of priorPeriod.balances) {
        priorBalancesByAccount.set(b.accountId, {
          closingDebit: b.closingDebit,
          closingCredit: b.closingCredit
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const acc of accounts) {
        let netDebit = new Prisma.Decimal(0);
        let netCredit = new Prisma.Decimal(0);

        for (const line of acc.journalLines) {
          netDebit = netDebit.add(line.debit);
          netCredit = netCredit.add(line.credit);
        }

        const prior = priorBalancesByAccount.get(acc.id);
        const openingDebit = prior ? prior.closingDebit : new Prisma.Decimal(0);
        const openingCredit = prior ? prior.closingCredit : new Prisma.Decimal(0);

        const closingDebit = openingDebit.add(netDebit);
        const closingCredit = openingCredit.add(netCredit);

        await tx.accountBalance.upsert({
          where: {
            accountId_accountingPeriodId: {
              accountId: acc.id,
              accountingPeriodId: periodId
            }
          },
          update: {
            openingDebit,
            openingCredit,
            netDebit,
            netCredit,
            closingDebit,
            closingCredit
          },
          create: {
            accountId: acc.id,
            accountingPeriodId: periodId,
            openingDebit,
            openingCredit,
            netDebit,
            netCredit,
            closingDebit,
            closingCredit
          }
        });
      }

      await tx.accountingPeriod.update({
        where: { id: periodId },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: userId
        }
      });

      await tx.financeAuditLog.create({
        data: {
          businessId,
          userId,
          action: 'PERIOD_CLOSED',
          details: { periodId, periodName: period.name }
        }
      });
    });

    return prisma.accountingPeriod.findUnique({
      where: { id: periodId },
      include: { balances: true }
    });
  }

  /**
   * Reopens a locked or closed period (for authorized adjustments).
   */
  async reopenPeriod(businessId: string, periodId: string, userId?: string) {
    const period = await prisma.accountingPeriod.findFirst({
      where: { id: periodId, businessId }
    });

    if (!period) {
      throw new Error(`Period ${periodId} not found`);
    }

    if (period.status === 'OPEN') {
      return period;
    }

    const updated = await prisma.accountingPeriod.update({
      where: { id: periodId },
      data: {
        status: 'OPEN',
        closedAt: null,
        closedById: null
      }
    });

    await prisma.financeAuditLog.create({
      data: {
        businessId,
        userId,
        action: 'PERIOD_REOPENED',
        details: { periodId, periodName: period.name, previousStatus: period.status }
      }
    });

    return updated;
  }
}

export const periodService = new PeriodService();
