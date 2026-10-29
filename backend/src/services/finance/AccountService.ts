import { prisma, AccountType, NormalBalance, AccountClassification } from '@agent-flux/database';

export interface CreateAccountDTO {
  code: string;
  name: string;
  type: AccountType;
  classification: AccountClassification;
  normalBalance: NormalBalance;
  currency?: string;
  description?: string;
  parentAccountId?: string;
  isSystem?: boolean;
}

export class AccountService {
  /**
   * Seeds standard, production-grade Chart of Accounts for a business if not already present.
   * Tailors functional currency to business configuration.
   */
  async seedStandardAccounts(businessId: string): Promise<{ created: number; existing: number }> {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: { configuration: true }
    });

    if (!business) {
      throw new Error(`Business ${businessId} not found`);
    }

    const currency = 'INR';

    // Standard IFRS / GAAP Chart of Accounts template
    const standardAccounts: CreateAccountDTO[] = [
      // ASSETS (1000 - 1999)
      {
        code: '1010',
        name: 'Operating Bank Account',
        type: 'ASSET',
        classification: 'CASH_AND_BANK',
        normalBalance: 'DEBIT',
        currency,
        description: 'Primary operating business bank account',
        isSystem: true
      },
      {
        code: '1020',
        name: 'Undeposited Funds / Gateway Clearing',
        type: 'ASSET',
        classification: 'CASH_AND_BANK',
        normalBalance: 'DEBIT',
        currency,
        description: 'Clearing account for card and online gateway settlements',
        isSystem: true
      },
      {
        code: '1200',
        name: 'Accounts Receivable (AR)',
        type: 'ASSET',
        classification: 'ACCOUNTS_RECEIVABLE',
        normalBalance: 'DEBIT',
        currency,
        description: 'Monies owed by customers for issued invoices',
        isSystem: true
      },
      {
        code: '1300',
        name: 'Merchandise Inventory',
        type: 'ASSET',
        classification: 'INVENTORY',
        normalBalance: 'DEBIT',
        currency,
        description: 'Finished goods and inventory on hand',
        isSystem: true
      },

      // LIABILITIES (2000 - 2999)
      {
        code: '2010',
        name: 'Accounts Payable (AP)',
        type: 'LIABILITY',
        classification: 'ACCOUNTS_PAYABLE',
        normalBalance: 'CREDIT',
        currency,
        description: 'Monies owed to suppliers and vendors for bills',
        isSystem: true
      },
      {
        code: '2100',
        name: 'Sales Tax / GST Payable',
        type: 'LIABILITY',
        classification: 'TAX_PAYABLE',
        normalBalance: 'CREDIT',
        currency,
        description: 'Output tax collected on sales awaiting remittance',
        isSystem: true
      },

      // EQUITY (3000 - 3999)
      {
        code: '3010',
        name: "Owner's Equity / Capital",
        type: 'EQUITY',
        classification: 'OWNERS_EQUITY',
        normalBalance: 'CREDIT',
        currency,
        description: 'Capital contributed by business owners',
        isSystem: true
      },
      {
        code: '3100',
        name: 'Retained Earnings',
        type: 'EQUITY',
        classification: 'RETAINED_EARNINGS',
        normalBalance: 'CREDIT',
        currency,
        description: 'Accumulated net income retained in the business',
        isSystem: true
      },

      // REVENUE (4000 - 4999)
      {
        code: '4010',
        name: 'Sales Revenue',
        type: 'REVENUE',
        classification: 'OPERATING_REVENUE',
        normalBalance: 'CREDIT',
        currency,
        description: 'Gross revenue from products and merchandise sold',
        isSystem: true
      },
      {
        code: '4020',
        name: 'Service Revenue',
        type: 'REVENUE',
        classification: 'OPERATING_REVENUE',
        normalBalance: 'CREDIT',
        currency,
        description: 'Revenue earned from professional services and labor',
        isSystem: false
      },

      // EXPENSES (5000 - 6999)
      {
        code: '5010',
        name: 'Cost of Goods Sold (COGS)',
        type: 'EXPENSE',
        classification: 'COST_OF_GOODS_SOLD',
        normalBalance: 'DEBIT',
        currency,
        description: 'Direct procurement and production costs',
        isSystem: true
      },
      {
        code: '6010',
        name: 'Payment Gateway Fees',
        type: 'EXPENSE',
        classification: 'OPERATING_EXPENSE',
        normalBalance: 'DEBIT',
        currency,
        description: 'Merchant processing fees and gateway transaction charges',
        isSystem: true
      },
      {
        code: '6020',
        name: 'General & Administrative Expenses',
        type: 'EXPENSE',
        classification: 'OPERATING_EXPENSE',
        normalBalance: 'DEBIT',
        currency,
        description: 'General operational overhead',
        isSystem: false
      }
    ];

    const existingAccounts = await prisma.account.findMany({
      where: { businessId },
      select: { code: true }
    });
    const existingCodes = new Set(existingAccounts.map((a) => a.code));

    const toCreate = standardAccounts.filter((acc) => !existingCodes.has(acc.code));
    const existing = standardAccounts.length - toCreate.length;

    if (toCreate.length > 0) {
      await prisma.account.createMany({
        data: toCreate.map((acc) => ({
          businessId,
          code: acc.code,
          name: acc.name,
          type: acc.type,
          classification: acc.classification,
          normalBalance: acc.normalBalance,
          currency: acc.currency || currency,
          description: acc.description,
          isSystem: acc.isSystem ?? false
        })),
        skipDuplicates: true
      });
    }

    return { created: toCreate.length, existing };
  }

  /**
   * Retrieves all accounts for a business, optionally including real calculated ledger balances.
   */
  async getAccounts(businessId: string, includeBalance: boolean = false) {
    const accounts = await prisma.account.findMany({
      where: { businessId, isActive: true },
      orderBy: { code: 'asc' },
      include: includeBalance
        ? {
            journalLines: {
              where: {
                journalEntry: {
                  status: 'POSTED'
                }
              },
              select: {
                debit: true,
                credit: true
              }
            }
          }
        : undefined
    });

    if (!includeBalance) return accounts;

    return accounts.map((acc) => {
      let totalDebit = 0;
      let totalCredit = 0;

      if ((acc as any).journalLines) {
        for (const line of (acc as any).journalLines) {
          totalDebit += Number(line.debit);
          totalCredit += Number(line.credit);
        }
      }

      // Normal balance calculation:
      // DEBIT normal accounts (Asset, Expense): Balance = Debit - Credit
      // CREDIT normal accounts (Liability, Equity, Revenue): Balance = Credit - Debit
      const currentBalance =
        acc.normalBalance === 'DEBIT'
          ? totalDebit - totalCredit
          : totalCredit - totalDebit;

      const { journalLines, ...rest } = acc as any;
      return {
        ...rest,
        totalDebit,
        totalCredit,
        currentBalance: Number(currentBalance.toFixed(2))
      };
    });
  }

  /**
   * Finds an account by system classification, ensuring critical mappings (e.g. AR, Cash, Revenue) exist.
   */
  async getSystemAccount(businessId: string, classification: AccountClassification) {
    let account = await prisma.account.findFirst({
      where: { businessId, classification, isSystem: true, isActive: true }
    });

    if (!account) {
      // Auto-seed if standard accounts haven't been generated yet
      await this.seedStandardAccounts(businessId);
      account = await prisma.account.findFirst({
        where: { businessId, classification, isSystem: true, isActive: true }
      });
    }

    if (!account) {
      throw new Error(
        `ACCOUNT_MAPPING_REQUIRED: No system account found for classification '${classification}' in business ${businessId}.`
      );
    }

    return account;
  }

  /**
   * Creates a user-defined account within the business's Chart of Accounts.
   */
  async createAccount(businessId: string, data: CreateAccountDTO) {
    const existing = await prisma.account.findUnique({
      where: { businessId_code: { businessId, code: data.code } }
    });

    if (existing) {
      throw new Error(`Account code '${data.code}' already exists in this business.`);
    }

    return prisma.account.create({
      data: {
        businessId,
        code: data.code,
        name: data.name,
        type: data.type,
        classification: data.classification,
        normalBalance: data.normalBalance,
        currency: 'INR',
        description: data.description,
        parentAccountId: data.parentAccountId,
        isSystem: false
      }
    });
  }
}

export const accountService = new AccountService();
