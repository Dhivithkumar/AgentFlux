import {
  prisma,
  BankTxStatus,
  Prisma
} from '@agent-flux/database';

export interface CreateBankFeedAccountDTO {
  accountId: string;
  institutionName: string;
  accountNumberMask: string;
  currency?: string;
  externalAccountId?: string;
}

export interface IngestBankTransactionDTO {
  transactionDate: Date | string;
  valueDate?: Date | string;
  amount: number | string | Prisma.Decimal; // Positive for deposit/credit, negative for withdrawal/debit
  description: string;
  referenceNumber?: string;
  currency?: string;
  rawPayload?: any;
}

export interface ReconciliationCandidate {
  bankTransactionId: string;
  journalLineId: string;
  bankAmount: string;
  journalAmount: string;
  confidenceScore: number;
  matchReasons: string[];
}

export class BankReconciliationService {
  /**
   * Registers a bank feed account linked to an Asset GL Account (e.g. 1010 Operating Bank).
   */
  async createBankFeedAccount(businessId: string, data: CreateBankFeedAccountDTO) {
    const account = await prisma.account.findUnique({
      where: { id: data.accountId }
    });

    if (!account || account.businessId !== businessId) {
      throw new Error(`GL Account ${data.accountId} not found in business ${businessId}`);
    }

    if (account.type !== 'ASSET') {
      throw new Error(`Bank feed account must be mapped to an ASSET account (got ${account.type})`);
    }

    const existing = await prisma.bankFeedAccount.findUnique({
      where: { accountId: data.accountId }
    });

    if (existing) {
      throw new Error(`Bank feed already linked to account ${account.code} (${account.name})`);
    }

    return prisma.bankFeedAccount.create({
      data: {
        businessId,
        accountId: data.accountId,
        institutionName: data.institutionName,
        accountNumberMask: data.accountNumberMask,
        currency: data.currency || account.currency || 'INR',
        externalAccountId: data.externalAccountId,
        syncStatus: 'ACTIVE'
      },
      include: {
        glAccount: true
      }
    });
  }

  /**
   * Retrieves all bank feed accounts with unmatched transaction counts and GL details.
   */
  async getBankFeedAccounts(businessId: string) {
    const feeds = await prisma.bankFeedAccount.findMany({
      where: { businessId },
      include: {
        glAccount: true,
        _count: {
          select: {
            transactions: true
          }
        }
      }
    });

    const feedsWithStatus = await Promise.all(
      feeds.map(async (feed) => {
        const [unmatchedCount, matchedCount] = await Promise.all([
          prisma.bankTransaction.count({
            where: { bankFeedAccountId: feed.id, status: 'UNMATCHED' }
          }),
          prisma.bankTransaction.count({
            where: { bankFeedAccountId: feed.id, status: 'MATCHED' }
          })
        ]);

        return {
          ...feed,
          unmatchedCount,
          matchedCount
        };
      })
    );

    return feedsWithStatus;
  }

  /**
   * Ingests bank statement transactions idempotently.
   */
  async ingestTransactions(
    businessId: string,
    bankFeedAccountId: string,
    transactions: IngestBankTransactionDTO[]
  ): Promise<{ inserted: number; skipped: number; total: number }> {
    const feed = await prisma.bankFeedAccount.findFirst({
      where: { id: bankFeedAccountId, businessId }
    });

    if (!feed) {
      throw new Error(`Bank feed account ${bankFeedAccountId} not found in business ${businessId}`);
    }

    let inserted = 0;
    let skipped = 0;

    for (const tx of transactions) {
      const txDate = new Date(tx.transactionDate);
      const amountDec = new Prisma.Decimal(tx.amount);
      const currency = tx.currency || feed.currency;

      try {
        await prisma.bankTransaction.upsert({
          where: {
            bankFeedAccountId_transactionDate_amount_description: {
              bankFeedAccountId,
              transactionDate: txDate,
              amount: amountDec,
              description: tx.description
            }
          },
          update: {},
          create: {
            bankFeedAccountId,
            transactionDate: txDate,
            valueDate: tx.valueDate ? new Date(tx.valueDate) : null,
            amount: amountDec,
            currency,
            description: tx.description,
            referenceNumber: tx.referenceNumber,
            rawPayload: tx.rawPayload ?? null,
            status: 'UNMATCHED'
          }
        });
        inserted++;
      } catch (err: any) {
        if (err.code === 'P2002') {
          skipped++;
        } else {
          throw err;
        }
      }
    }

    await prisma.bankFeedAccount.update({
      where: { id: bankFeedAccountId },
      data: { lastSyncedAt: new Date() }
    });

    return { inserted, skipped, total: transactions.length };
  }

  /**
   * Computes match candidates between unmatched bank transactions and un-reconciled GL journal lines.
   */
  async findMatchCandidates(
    businessId: string,
    bankFeedAccountId: string,
    maxDaysVariance: number = 7
  ): Promise<ReconciliationCandidate[]> {
    const feed = await prisma.bankFeedAccount.findFirst({
      where: { id: bankFeedAccountId, businessId }
    });

    if (!feed) {
      throw new Error(`Bank feed account ${bankFeedAccountId} not found`);
    }

    // Unmatched bank transactions
    const bankTxs = await prisma.bankTransaction.findMany({
      where: { bankFeedAccountId, status: 'UNMATCHED' },
      orderBy: { transactionDate: 'asc' }
    });

    // Unreconciled journal lines for this GL account from POSTED entries
    const unreconciledLines = await prisma.journalLine.findMany({
      where: {
        accountId: feed.accountId,
        reconciledLine: null,
        journalEntry: {
          businessId,
          status: 'POSTED'
        }
      },
      include: {
        journalEntry: true
      }
    });

    const candidates: ReconciliationCandidate[] = [];

    for (const bTx of bankTxs) {
      const bAmount = bTx.amount;
      const bDate = new Date(bTx.transactionDate).getTime();
      const isDeposit = bAmount.greaterThan(0);
      const absAmount = bAmount.abs();

      for (const line of unreconciledLines) {
        // Line amount check:
        // If bank tx is deposit (> 0), GL line must be DEBIT
        // If bank tx is withdrawal (< 0), GL line must be CREDIT
        const lineAmount = isDeposit ? line.debit : line.credit;
        if (!lineAmount.equals(absAmount)) {
          continue; // Exact amount match is required for reconciliation candidate
        }

        const lDate = new Date(line.journalEntry.postingDate).getTime();
        const daysDiff = Math.abs((bDate - lDate) / (1000 * 60 * 60 * 24));
        if (daysDiff > maxDaysVariance) {
          continue;
        }

        let confidenceScore = 70;
        const matchReasons: string[] = [`Exact amount match (${absAmount.toString()})`];

        if (daysDiff <= 1) {
          confidenceScore += 15;
          matchReasons.push('Transaction date matches within 24 hours');
        } else if (daysDiff <= 3) {
          confidenceScore += 10;
          matchReasons.push(`Transaction date within ${Math.round(daysDiff)} days`);
        }

        // Reference number matching
        if (bTx.referenceNumber) {
          const ref = bTx.referenceNumber.toLowerCase();
          const memo = (line.journalEntry.memo || '').toLowerCase();
          const sourceId = (line.journalEntry.sourceId || '').toLowerCase();
          const entryNum = line.journalEntry.entryNumber.toLowerCase();

          if (memo.includes(ref) || sourceId.includes(ref) || entryNum.includes(ref)) {
            confidenceScore += 15;
            matchReasons.push(`Reference '${bTx.referenceNumber}' matches journal entry`);
          }
        }

        // Description token overlap matching
        const bDescWords = bTx.description.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        const lDesc = `${line.description || ''} ${line.journalEntry.memo}`.toLowerCase();
        const matchedWords = bDescWords.filter((w) => lDesc.includes(w));
        if (matchedWords.length > 0) {
          confidenceScore += Math.min(10, matchedWords.length * 5);
          matchReasons.push(`Description tokens match: ${matchedWords.slice(0, 3).join(', ')}`);
        }

        confidenceScore = Math.min(100, confidenceScore);

        candidates.push({
          bankTransactionId: bTx.id,
          journalLineId: line.id,
          bankAmount: bAmount.toString(),
          journalAmount: absAmount.toString(),
          confidenceScore,
          matchReasons
        });
      }
    }

    return candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);
  }

  /**
   * Automatically reconciles bank transactions that meet the confidence threshold.
   */
  async autoReconcile(
    businessId: string,
    bankFeedAccountId: string,
    threshold: number = 90,
    userId?: string
  ): Promise<{
    matchedCount: number;
    unmatchedCount: number;
    matches: Array<{ bankTxId: string; journalLineId: string; score: number }>;
  }> {
    const candidates = await this.findMatchCandidates(businessId, bankFeedAccountId);
    const highConfidence = candidates.filter((c) => c.confidenceScore >= threshold);

    // Filter to unambiguous 1-to-1 pairs:
    const bankTxCandidateCount = new Map<string, number>();
    const lineCandidateCount = new Map<string, number>();

    for (const c of highConfidence) {
      bankTxCandidateCount.set(c.bankTransactionId, (bankTxCandidateCount.get(c.bankTransactionId) || 0) + 1);
      lineCandidateCount.set(c.journalLineId, (lineCandidateCount.get(c.journalLineId) || 0) + 1);
    }

    const uniquePairs = highConfidence.filter(
      (c) => bankTxCandidateCount.get(c.bankTransactionId) === 1 && lineCandidateCount.get(c.journalLineId) === 1
    );

    const matches: Array<{ bankTxId: string; journalLineId: string; score: number }> = [];

    await prisma.$transaction(async (tx) => {
      for (const pair of uniquePairs) {
        // Verify neither is already matched
        const isAlreadyMatched = await tx.bankTransactionMatch.findFirst({
          where: {
            OR: [
              { bankTransactionId: pair.bankTransactionId },
              { journalLineId: pair.journalLineId }
            ]
          }
        });

        if (isAlreadyMatched) continue;

        await tx.bankTransactionMatch.create({
          data: {
            bankTransactionId: pair.bankTransactionId,
            journalLineId: pair.journalLineId,
            matchedById: userId
          }
        });

        await tx.bankTransaction.update({
          where: { id: pair.bankTransactionId },
          data: { status: 'MATCHED' }
        });

        await tx.financeAuditLog.create({
          data: {
            businessId,
            userId,
            action: 'BANK_TX_AUTO_MATCHED',
            details: {
              bankTransactionId: pair.bankTransactionId,
              journalLineId: pair.journalLineId,
              confidenceScore: pair.confidenceScore,
              reasons: pair.matchReasons
            }
          }
        });

        matches.push({
          bankTxId: pair.bankTransactionId,
          journalLineId: pair.journalLineId,
          score: pair.confidenceScore
        });
      }
    });

    const remainingUnmatched = await prisma.bankTransaction.count({
      where: { bankFeedAccountId, status: 'UNMATCHED' }
    });

    return {
      matchedCount: matches.length,
      unmatchedCount: remainingUnmatched,
      matches
    };
  }

  /**
   * Manually reconciles a bank transaction with a specific journal line.
   */
  async manualMatch(
    businessId: string,
    bankTransactionId: string,
    journalLineId: string,
    userId?: string
  ) {
    const bankTx = await prisma.bankTransaction.findUnique({
      where: { id: bankTransactionId },
      include: { bankFeedAccount: true, match: true }
    });

    if (!bankTx || bankTx.bankFeedAccount.businessId !== businessId) {
      throw new Error(`Bank transaction ${bankTransactionId} not found in business`);
    }

    if (bankTx.match) {
      throw new Error(`Bank transaction is already matched to journal line ${bankTx.match.journalLineId}`);
    }

    const journalLine = await prisma.journalLine.findUnique({
      where: { id: journalLineId },
      include: {
        journalEntry: true,
        reconciledLine: true
      }
    });

    if (!journalLine || journalLine.journalEntry.businessId !== businessId) {
      throw new Error(`Journal line ${journalLineId} not found in business`);
    }

    if (journalLine.reconciledLine) {
      throw new Error(`Journal line is already reconciled to bank transaction ${journalLine.reconciledLine.bankTransactionId}`);
    }

    if (journalLine.accountId !== bankTx.bankFeedAccount.accountId) {
      throw new Error('GL Account mismatch: Bank feed and journal line must map to the same account');
    }

    return prisma.$transaction(async (tx) => {
      const match = await tx.bankTransactionMatch.create({
        data: {
          bankTransactionId,
          journalLineId,
          matchedById: userId
        }
      });

      await tx.bankTransaction.update({
        where: { id: bankTransactionId },
        data: { status: 'MATCHED' }
      });

      await tx.financeAuditLog.create({
        data: {
          businessId,
          userId,
          action: 'BANK_TX_MANUAL_MATCHED',
          details: { bankTransactionId, journalLineId }
        }
      });

      return match;
    });
  }

  /**
   * Unmatches a previously reconciled bank transaction.
   */
  async unmatch(businessId: string, bankTransactionId: string, userId?: string) {
    const bankTx = await prisma.bankTransaction.findUnique({
      where: { id: bankTransactionId },
      include: { bankFeedAccount: true, match: true }
    });

    if (!bankTx || bankTx.bankFeedAccount.businessId !== businessId) {
      throw new Error(`Bank transaction ${bankTransactionId} not found`);
    }

    if (!bankTx.match) {
      return { status: 'NOT_MATCHED' };
    }

    const journalLineId = bankTx.match.journalLineId;

    await prisma.$transaction(async (tx) => {
      await tx.bankTransactionMatch.delete({
        where: { bankTransactionId }
      });

      await tx.bankTransaction.update({
        where: { id: bankTransactionId },
        data: { status: 'UNMATCHED' }
      });

      await tx.financeAuditLog.create({
        data: {
          businessId,
          userId,
          action: 'BANK_TX_UNMATCHED',
          details: { bankTransactionId, journalLineId }
        }
      });
    });

    return { status: 'UNMATCHED_SUCCESS' };
  }

  /**
   * Excludes a bank transaction from reconciliation (e.g. non-operational bank adjustment).
   */
  async excludeTransaction(
    businessId: string,
    bankTransactionId: string,
    reason: string,
    userId?: string
  ) {
    const bankTx = await prisma.bankTransaction.findUnique({
      where: { id: bankTransactionId },
      include: { bankFeedAccount: true }
    });

    if (!bankTx || bankTx.bankFeedAccount.businessId !== businessId) {
      throw new Error(`Bank transaction ${bankTransactionId} not found`);
    }

    if (bankTx.status === 'MATCHED') {
      throw new Error('Cannot exclude a matched transaction. Unmatch it first.');
    }

    const updated = await prisma.bankTransaction.update({
      where: { id: bankTransactionId },
      data: { status: 'EXCLUDED' }
    });

    await prisma.financeAuditLog.create({
      data: {
        businessId,
        userId,
        action: 'BANK_TX_EXCLUDED',
        details: { bankTransactionId, reason }
      }
    });

    return updated;
  }

  /**
   * Generates a formal Bank Reconciliation Statement comparing Bank Balance vs General Ledger Balance.
   */
  async getReconciliationReport(
    businessId: string,
    bankFeedAccountId: string,
    asOfDate?: Date
  ) {
    const cutoff = asOfDate ? new Date(asOfDate) : new Date();

    const feed = await prisma.bankFeedAccount.findFirst({
      where: { id: bankFeedAccountId, businessId },
      include: { glAccount: true }
    });

    if (!feed) {
      throw new Error(`Bank feed account ${bankFeedAccountId} not found`);
    }

    // 1. Bank Statement Transactions
    const bankTxs = await prisma.bankTransaction.findMany({
      where: {
        bankFeedAccountId,
        transactionDate: { lte: cutoff }
      },
      include: { match: true }
    });

    let statementBalance = new Prisma.Decimal(0);
    let matchedBankTotal = new Prisma.Decimal(0);
    let unmatchedBankDeposits = new Prisma.Decimal(0);
    let unmatchedBankWithdrawals = new Prisma.Decimal(0);

    for (const tx of bankTxs) {
      if (tx.status === 'EXCLUDED') continue;

      statementBalance = statementBalance.add(tx.amount);

      if (tx.status === 'MATCHED') {
        matchedBankTotal = matchedBankTotal.add(tx.amount);
      } else {
        if (tx.amount.greaterThan(0)) {
          unmatchedBankDeposits = unmatchedBankDeposits.add(tx.amount);
        } else {
          unmatchedBankWithdrawals = unmatchedBankWithdrawals.add(tx.amount.abs());
        }
      }
    }

    // 2. GL Account Ledger Balance
    const glLines = await prisma.journalLine.findMany({
      where: {
        accountId: feed.accountId,
        journalEntry: {
          businessId,
          status: 'POSTED',
          postingDate: { lte: cutoff }
        }
      },
      include: { reconciledLine: true }
    });

    let glTotalDebit = new Prisma.Decimal(0);
    let glTotalCredit = new Prisma.Decimal(0);
    let unmatchedGlDebits = new Prisma.Decimal(0);
    let unmatchedGlCredits = new Prisma.Decimal(0);

    for (const line of glLines) {
      glTotalDebit = glTotalDebit.add(line.debit);
      glTotalCredit = glTotalCredit.add(line.credit);

      if (!line.reconciledLine) {
        unmatchedGlDebits = unmatchedGlDebits.add(line.debit);
        unmatchedGlCredits = unmatchedGlCredits.add(line.credit);
      }
    }

    // Normal balance for ASSET is DEBIT: Balance = Debit - Credit
    const ledgerBalance = glTotalDebit.sub(glTotalCredit);

    // Difference between Bank Statement Balance and General Ledger Balance
    const variance = statementBalance.sub(ledgerBalance);
    const isReconciled = variance.isZero() && unmatchedBankDeposits.isZero() && unmatchedBankWithdrawals.isZero() && unmatchedGlDebits.isZero() && unmatchedGlCredits.isZero();

    return {
      asOfDate: cutoff.toISOString(),
      bankFeedAccount: {
        id: feed.id,
        institutionName: feed.institutionName,
        accountNumberMask: feed.accountNumberMask,
        currency: feed.currency,
        glAccount: {
          id: feed.glAccount.id,
          code: feed.glAccount.code,
          name: feed.glAccount.name
        }
      },
      summary: {
        statementBalance: statementBalance.toFixed(2),
        ledgerBalance: ledgerBalance.toFixed(2),
        variance: variance.toFixed(2),
        isReconciled
      },
      breakdown: {
        matchedBankTotal: matchedBankTotal.toFixed(2),
        unmatchedBankDeposits: unmatchedBankDeposits.toFixed(2),
        unmatchedBankWithdrawals: unmatchedBankWithdrawals.toFixed(2),
        unmatchedGlDebits: unmatchedGlDebits.toFixed(2),
        unmatchedGlCredits: unmatchedGlCredits.toFixed(2)
      },
      counts: {
        totalBankTransactions: bankTxs.length,
        matchedCount: bankTxs.filter((t) => t.status === 'MATCHED').length,
        unmatchedCount: bankTxs.filter((t) => t.status === 'UNMATCHED').length,
        excludedCount: bankTxs.filter((t) => t.status === 'EXCLUDED').length
      }
    };
  }
}

export const bankReconciliationService = new BankReconciliationService();
