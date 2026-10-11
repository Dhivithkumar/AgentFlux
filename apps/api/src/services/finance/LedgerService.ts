import {
  prisma,
  JournalEntryStatus,
  SourceDocumentType,
  Prisma
} from '@agent-flux/database';
import { periodService } from './PeriodService';

export interface JournalLineInput {
  accountId: string;
  debit?: number | string | Prisma.Decimal;
  credit?: number | string | Prisma.Decimal;
  description?: string;
  currency?: string;
  exchangeRate?: number | string | Prisma.Decimal;
  foreignDebit?: number | string | Prisma.Decimal;
  foreignCredit?: number | string | Prisma.Decimal;
}

export interface CreateJournalEntryInput {
  postingDate?: Date | string;
  memo: string;
  sourceType: SourceDocumentType;
  sourceId?: string;
  idempotencyKey?: string;
  lines: JournalLineInput[];
  autoPost?: boolean;
}

export interface JournalQueryFilters {
  status?: JournalEntryStatus;
  sourceType?: SourceDocumentType;
  sourceId?: string;
  accountId?: string;
  periodId?: string;
  startDate?: Date | string;
  endDate?: Date | string;
  limit?: number;
  offset?: number;
}

export class LedgerService {
  /**
   * Generates a sequential entry number in the format JE-YYYY-XXXXX
   */
  private async generateNextEntryNumber(businessId: string, date: Date): Promise<string> {
    const year = date.getUTCFullYear();
    const prefix = `JE-${year}-`;

    const latest = await prisma.journalEntry.findFirst({
      where: {
        businessId,
        entryNumber: { startsWith: prefix }
      },
      orderBy: { entryNumber: 'desc' },
      select: { entryNumber: true }
    });

    let nextSeq = 1;
    if (latest && latest.entryNumber) {
      const match = latest.entryNumber.match(/JE-\d{4}-(\d+)/);
      if (match && match[1]) {
        nextSeq = parseInt(match[1], 10) + 1;
      }
    }

    return `${prefix}${String(nextSeq).padStart(5, '0')}`;
  }

  /**
   * Creates a journal entry adhering to all 6 accounting invariants.
   * If autoPost is true, validates and transitions to POSTED atomically.
   */
  async createJournalEntry(
    businessId: string,
    input: CreateJournalEntryInput,
    userId?: string
  ): Promise<any> {
    // 1. Idempotency verification
    if (input.idempotencyKey) {
      const existing = await prisma.journalEntry.findUnique({
        where: {
          businessId_idempotencyKey: {
            businessId,
            idempotencyKey: input.idempotencyKey
          }
        },
        include: { lines: { include: { account: true } }, period: true }
      });
      if (existing) {
        return existing;
      }
    }

    if (input.sourceType && input.sourceId) {
      const existing = await prisma.journalEntry.findUnique({
        where: {
          businessId_sourceType_sourceId: {
            businessId,
            sourceType: input.sourceType,
            sourceId: input.sourceId
          }
        },
        include: { lines: { include: { account: true } }, period: true }
      });
      if (existing) {
        return existing;
      }
    }

    // 2. Validate line count
    if (!input.lines || input.lines.length < 2) {
      throw new Error(
        'INVALID_JOURNAL_ENTRY: A double-entry journal entry must contain at least two lines.'
      );
    }

    // 3. Resolve posting date and Accounting Period
    const postingDate = input.postingDate ? new Date(input.postingDate) : new Date();
    const period = await periodService.getOrCreateOpenPeriodForDate(businessId, postingDate);

    // 4. Validate accounts existence & business tenant isolation
    const accountIds = input.lines.map((l) => l.accountId);
    const accounts = await prisma.account.findMany({
      where: {
        id: { in: accountIds },
        businessId,
        isActive: true
      }
    });

    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    for (const line of input.lines) {
      if (!accountMap.has(line.accountId)) {
        throw new Error(
          `ACCOUNT_NOT_FOUND: Account ID '${line.accountId}' does not exist or is inactive in business '${businessId}'.`
        );
      }
    }

    // 5. Compute line decimals and validate non-negative invariant
    let totalDebit = new Prisma.Decimal(0);
    let totalCredit = new Prisma.Decimal(0);

    const normalizedLines = input.lines.map((line, index) => {
      const debitDec = new Prisma.Decimal(line.debit ?? 0);
      const creditDec = new Prisma.Decimal(line.credit ?? 0);

      if (debitDec.isNegative() || creditDec.isNegative()) {
        throw new Error(
          `NEGATIVE_AMOUNT_REJECTED: Line ${index + 1} has negative debit or credit amount. Double-entry lines must be positive.`
        );
      }

      if (debitDec.isZero() && creditDec.isZero()) {
        throw new Error(
          `ZERO_AMOUNT_REJECTED: Line ${index + 1} has zero for both debit and credit. Every line must have an amount.`
        );
      }

      if (!debitDec.isZero() && !creditDec.isZero()) {
        throw new Error(
          `AMBIGUOUS_LINE_REJECTED: Line ${index + 1} has both debit (${debitDec}) and credit (${creditDec}). A line must be either debit or credit, not both.`
        );
      }

      totalDebit = totalDebit.add(debitDec);
      totalCredit = totalCredit.add(creditDec);

      const acc = accountMap.get(line.accountId)!;
      const currency = line.currency || acc.currency || 'INR';
      const exchangeRate = line.exchangeRate ? new Prisma.Decimal(line.exchangeRate) : new Prisma.Decimal(1.0);

      return {
        lineNumber: index + 1,
        accountId: line.accountId,
        description: line.description || input.memo,
        debit: debitDec,
        credit: creditDec,
        currency,
        exchangeRate,
        foreignDebit: line.foreignDebit ? new Prisma.Decimal(line.foreignDebit) : null,
        foreignCredit: line.foreignCredit ? new Prisma.Decimal(line.foreignCredit) : null
      };
    });

    // 6. Enforce Double-Entry Invariant: Debits MUST equal Credits
    if (!totalDebit.equals(totalCredit)) {
      const diff = totalDebit.sub(totalCredit).abs();
      throw new Error(
        `LEDGER_UNBALANCED: Debits (${totalDebit.toString()}) do not equal Credits (${totalCredit.toString()}). Discrepancy: ${diff.toString()}`
      );
    }

    // 7. Atomic persistence
    const entryNumber = await this.generateNextEntryNumber(businessId, postingDate);
    const initialStatus: JournalEntryStatus = input.autoPost ? 'POSTED' : 'DRAFT';

    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.journalEntry.create({
        data: {
          businessId,
          entryNumber,
          postingDate,
          accountingPeriodId: period.id,
          status: initialStatus,
          memo: input.memo,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          idempotencyKey: input.idempotencyKey,
          totalDebit,
          totalCredit,
          postedAt: input.autoPost ? new Date() : null,
          postedById: input.autoPost ? userId : null,
          lines: {
            create: normalizedLines
          }
        },
        include: {
          lines: {
            include: { account: true }
          },
          period: true
        }
      });

      await tx.financeAuditLog.create({
        data: {
          businessId,
          journalEntryId: created.id,
          userId,
          action: input.autoPost ? 'JOURNAL_CREATED_AND_POSTED' : 'JOURNAL_CREATED_DRAFT',
          details: {
            entryNumber: created.entryNumber,
            totalDebit: totalDebit.toString(),
            totalCredit: totalCredit.toString(),
            memo: input.memo,
            sourceType: input.sourceType,
            sourceId: input.sourceId
          }
        }
      });

      return created;
    }, { maxWait: 10000, timeout: 20000 });

    return entry;
  }

  /**
   * Posts an existing DRAFT journal entry to the general ledger.
   * Checks period status, invariants, and transitions atomically.
   */
  async postJournalEntry(businessId: string, entryId: string, userId?: string) {
    const entry = await prisma.journalEntry.findFirst({
      where: { id: entryId, businessId },
      include: {
        lines: true,
        period: true
      }
    });

    if (!entry) {
      throw new Error(`Journal entry ${entryId} not found`);
    }

    if (entry.status === 'POSTED') {
      return entry; // Idempotent return
    }

    if (entry.status === 'VOIDED') {
      throw new Error(`Cannot post journal entry ${entry.entryNumber}: It is VOIDED`);
    }

    // Verify period is still open
    if (entry.period.status !== 'OPEN') {
      throw new Error(
        `PERIOD_LOCKED: Cannot post to period '${entry.period.name}' because it is ${entry.period.status}`
      );
    }

    // Verify balance invariant
    if (!entry.totalDebit.equals(entry.totalCredit)) {
      throw new Error(
        `LEDGER_UNBALANCED: Cannot post unbalanced entry ${entry.entryNumber}. Debits: ${entry.totalDebit}, Credits: ${entry.totalCredit}`
      );
    }

    const posted = await prisma.$transaction(async (tx) => {
      const updated = await tx.journalEntry.update({
        where: { id: entryId },
        data: {
          status: 'POSTED',
          postedAt: new Date(),
          postedById: userId
        },
        include: {
          lines: {
            include: { account: true }
          },
          period: true
        }
      });

      await tx.financeAuditLog.create({
        data: {
          businessId,
          journalEntryId: entry.id,
          userId,
          action: 'JOURNAL_POSTED',
          details: {
            entryNumber: entry.entryNumber,
            totalDebit: entry.totalDebit.toString(),
            totalCredit: entry.totalCredit.toString()
          }
        }
      });

      return updated;
    });

    return posted;
  }

  /**
   * Voids or reverses a journal entry.
   * - If DRAFT: directly marks as VOIDED.
   * - If POSTED: creates a full reversing journal entry to preserve immutable ledger audit trail.
   */
  async voidJournalEntry(
    businessId: string,
    entryId: string,
    reason: string,
    userId?: string
  ) {
    const entry = await prisma.journalEntry.findFirst({
      where: { id: entryId, businessId },
      include: {
        lines: { include: { account: true } },
        period: true,
        reversalEntry: true,
        reversedByEntry: true
      }
    });

    if (!entry) {
      throw new Error(`Journal entry ${entryId} not found`);
    }

    if (entry.status === 'VOIDED') {
      return { status: 'ALREADY_VOIDED', entry };
    }

    if (entry.reversedByEntry) {
      throw new Error(
        `ALREADY_REVERSED: Entry ${entry.entryNumber} has already been reversed by ${entry.reversedByEntry.entryNumber}`
      );
    }

    // If DRAFT, simply mark VOIDED
    if (entry.status === 'DRAFT') {
      const voided = await prisma.journalEntry.update({
        where: { id: entryId },
        data: { status: 'VOIDED' }
      });

      await prisma.financeAuditLog.create({
        data: {
          businessId,
          journalEntryId: entry.id,
          userId,
          action: 'JOURNAL_DRAFT_VOIDED',
          details: { entryNumber: entry.entryNumber, reason }
        }
      });

      return { status: 'DRAFT_VOIDED', entry: voided };
    }

    // If POSTED: MUST create reversing entry!
    const today = new Date();
    const period = await periodService.getOrCreateOpenPeriodForDate(businessId, today);
    const reversalEntryNumber = await this.generateNextEntryNumber(businessId, today);

    // Invert lines: original debit becomes credit, original credit becomes debit
    const reversedLines = entry.lines.map((line, idx) => ({
      lineNumber: idx + 1,
      accountId: line.accountId,
      description: `Reversal of line ${line.lineNumber}: ${line.description || reason}`,
      debit: line.credit, // Invert
      credit: line.debit, // Invert
      currency: line.currency,
      exchangeRate: line.exchangeRate
    }));

    const reversal = await prisma.$transaction(async (tx) => {
      const createdReversal = await tx.journalEntry.create({
        data: {
          businessId,
          entryNumber: reversalEntryNumber,
          postingDate: today,
          accountingPeriodId: period.id,
          status: 'POSTED',
          memo: `Reversal of ${entry.entryNumber}: ${reason}`,
          sourceType: entry.sourceType,
          sourceId: entry.sourceId ? `${entry.sourceId}-reversal` : undefined,
          totalDebit: entry.totalCredit,
          totalCredit: entry.totalDebit,
          postedAt: today,
          postedById: userId,
          reversalOfEntryId: entry.id,
          lines: {
            create: reversedLines
          }
        },
        include: {
          lines: { include: { account: true } },
          period: true
        }
      });

      await tx.financeAuditLog.create({
        data: {
          businessId,
          journalEntryId: createdReversal.id,
          userId,
          action: 'JOURNAL_REVERSAL_POSTED',
          details: {
            originalEntryNumber: entry.entryNumber,
            reversalEntryNumber: createdReversal.entryNumber,
            reason
          }
        }
      });

      return createdReversal;
    }, { maxWait: 10000, timeout: 20000 });

    return {
      status: 'REVERSED',
      originalEntry: entry,
      reversalEntry: reversal
    };
  }

  /**
   * Retrieves journal entries matching the given query filters.
   */
  async getJournalEntries(businessId: string, filters: JournalQueryFilters = {}) {
    const where: Prisma.JournalEntryWhereInput = {
      businessId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.sourceType ? { sourceType: filters.sourceType } : {}),
      ...(filters.sourceId ? { sourceId: filters.sourceId } : {}),
      ...(filters.periodId ? { accountingPeriodId: filters.periodId } : {})
    };

    if (filters.startDate || filters.endDate) {
      where.postingDate = {};
      if (filters.startDate) where.postingDate.gte = new Date(filters.startDate);
      if (filters.endDate) where.postingDate.lte = new Date(filters.endDate);
    }

    if (filters.accountId) {
      where.lines = {
        some: { accountId: filters.accountId }
      };
    }

    const [total, entries] = await Promise.all([
      prisma.journalEntry.count({ where }),
      prisma.journalEntry.findMany({
        where,
        orderBy: { postingDate: 'desc' },
        skip: filters.offset || 0,
        take: filters.limit || 50,
        include: {
          lines: {
            include: { account: true },
            orderBy: { lineNumber: 'asc' }
          },
          period: true,
          reversalEntry: { select: { id: true, entryNumber: true } },
          reversedByEntry: { select: { id: true, entryNumber: true } }
        }
      })
    ]);

    return { total, entries };
  }

  /**
   * Retrieves a single journal entry by ID.
   */
  async getJournalEntryById(businessId: string, entryId: string) {
    return prisma.journalEntry.findFirst({
      where: { id: entryId, businessId },
      include: {
        lines: {
          include: { account: true },
          orderBy: { lineNumber: 'asc' }
        },
        period: true,
        auditLogs: { orderBy: { timestamp: 'asc' } },
        reversalEntry: true,
        reversedByEntry: true
      }
    });
  }

  /**
   * Computes the real-time Trial Balance across all Chart of Accounts.
   * Asserts whether the General Ledger is in mathematical equilibrium (Total Debits == Total Credits).
   */
  async getTrialBalance(businessId: string, asOfDate?: Date) {
    const cutoff = asOfDate ? new Date(asOfDate) : new Date();

    const accounts = await prisma.account.findMany({
      where: { businessId, isActive: true },
      orderBy: { code: 'asc' },
      include: {
        journalLines: {
          where: {
            journalEntry: {
              status: 'POSTED',
              postingDate: { lte: cutoff }
            }
          },
          select: {
            debit: true,
            credit: true
          }
        }
      }
    });

    let grandTotalDebit = new Prisma.Decimal(0);
    let grandTotalCredit = new Prisma.Decimal(0);

    const rows = accounts.map((acc) => {
      let totalDebit = new Prisma.Decimal(0);
      let totalCredit = new Prisma.Decimal(0);

      for (const line of acc.journalLines) {
        totalDebit = totalDebit.add(line.debit);
        totalCredit = totalCredit.add(line.credit);
      }

      grandTotalDebit = grandTotalDebit.add(totalDebit);
      grandTotalCredit = grandTotalCredit.add(totalCredit);

      // Calculate net balance according to normal balance convention
      const netDebit = totalDebit.greaterThan(totalCredit) ? totalDebit.sub(totalCredit) : new Prisma.Decimal(0);
      const netCredit = totalCredit.greaterThan(totalDebit) ? totalCredit.sub(totalDebit) : new Prisma.Decimal(0);

      return {
        accountId: acc.id,
        code: acc.code,
        name: acc.name,
        type: acc.type,
        classification: acc.classification,
        normalBalance: acc.normalBalance,
        currency: acc.currency,
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        netDebit: netDebit.toFixed(2),
        netCredit: netCredit.toFixed(2)
      };
    });

    const isBalanced = grandTotalDebit.equals(grandTotalCredit);

    return {
      asOfDate: cutoff.toISOString(),
      isBalanced,
      totalDebit: grandTotalDebit.toFixed(2),
      totalCredit: grandTotalCredit.toFixed(2),
      difference: grandTotalDebit.sub(grandTotalCredit).abs().toFixed(2),
      rows
    };
  }
}

export const ledgerService = new LedgerService();
