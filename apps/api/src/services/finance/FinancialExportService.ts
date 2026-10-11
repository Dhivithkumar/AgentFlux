import PDFDocument from 'pdfkit';
import crypto from 'crypto';
import { prisma } from '@agent-flux/database';
import { financialReportingService, DateRangeFilters, BalanceSheetReport, ProfitAndLossReport, CashFlowReport } from './FinancialReportingService';
import { ledgerService } from './LedgerService';
import { bankReconciliationService } from './BankReconciliationService';

interface BusinessHeaderInfo {
  name: string;
  legalName: string;
  currency: string;
  taxId?: string;
  address?: string;
}

export class FinancialExportService {
  /**
   * Helper to retrieve authoritative business identity & preferences for report headers.
   */
  private async getBusinessHeader(businessId: string): Promise<BusinessHeaderInfo> {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: { configuration: true }
    });

    if (!business) {
      throw new Error(`Business not found: ${businessId}`);
    }

    const contactInfo = (business.contactInfo as any) || {};
    const finConfig = (business.configuration?.financialConfig as any) || {};

    const legalName = finConfig.legalBusinessName || business.name;
    const currency = 'INR';
    const taxId = finConfig.taxId || finConfig.gstin || contactInfo.taxId || '';
    const address = contactInfo.address || [contactInfo.city, contactInfo.state, contactInfo.country].filter(Boolean).join(', ') || '';

    return {
      name: business.name,
      legalName,
      currency,
      taxId,
      address
    };
  }

  /**
   * Formats a monetary amount into a clean, ISO-compliant INR currency string with en-IN Lakh/Crore grouping.
   */
  private formatAmount(val: string | number | null | undefined, currency = 'INR'): string {
    const num = typeof val === 'string' ? parseFloat(val) : (val ?? 0);
    const abs = Math.abs(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num < 0) {
      return `(${currency} ${abs})`;
    }
    return `${currency} ${abs}`;
  }

  /**
   * Escapes a field for standard RFC 4180 CSV export.
   */
  private escapeCsv(field: any): string {
    if (field === null || field === undefined) return '""';
    const str = String(field).replace(/"/g, '""');
    return `"${str}"`;
  }

  // =========================================================================
  // 1. BALANCE SHEET EXPORTS (PDF & CSV)
  // =========================================================================

  async exportBalanceSheetCsv(businessId: string, asOfDate?: Date | string): Promise<string> {
    const header = await this.getBusinessHeader(businessId);
    const dateObj = asOfDate ? new Date(asOfDate) : undefined;
    const report = await financialReportingService.getBalanceSheet(businessId, dateObj);

    const rows: string[] = [];
    rows.push(this.escapeCsv(`STATEMENT OF FINANCIAL POSITION (BALANCE SHEET)`));
    rows.push(`${this.escapeCsv('Business:')},${this.escapeCsv(header.legalName)}`);
    rows.push(`${this.escapeCsv('As of Date:')},${this.escapeCsv(report.asOfDate)}`);
    rows.push(`${this.escapeCsv('Reporting Currency:')},${this.escapeCsv(report.currency)}`);
    rows.push(`${this.escapeCsv('Status:')},${this.escapeCsv(report.isBalanced ? 'BALANCED' : `OUT OF BALANCE (Variance: ${report.variance})`)}`);
    rows.push('');

    // Column Headers
    rows.push([
      this.escapeCsv('Section'),
      this.escapeCsv('Category'),
      this.escapeCsv('Account Code'),
      this.escapeCsv('Account Name'),
      this.escapeCsv('Classification'),
      this.escapeCsv(`Balance (${report.currency})`)
    ].join(','));

    // Current Assets
    for (const acc of report.assets.currentAssets) {
      rows.push([
        this.escapeCsv('Assets'),
        this.escapeCsv('Current Assets'),
        this.escapeCsv(acc.code),
        this.escapeCsv(acc.name),
        this.escapeCsv(acc.classification),
        acc.balance
      ].join(','));
    }
    rows.push([this.escapeCsv('Assets'), this.escapeCsv('Total Current Assets'), '""', '""', '""', report.assets.totalCurrentAssets].join(','));

    // Non-Current Assets
    for (const acc of report.assets.nonCurrentAssets) {
      rows.push([
        this.escapeCsv('Assets'),
        this.escapeCsv('Non-Current Assets'),
        this.escapeCsv(acc.code),
        this.escapeCsv(acc.name),
        this.escapeCsv(acc.classification),
        acc.balance
      ].join(','));
    }
    rows.push([this.escapeCsv('Assets'), this.escapeCsv('Total Non-Current Assets'), '""', '""', '""', report.assets.totalNonCurrentAssets].join(','));
    rows.push([this.escapeCsv('Assets'), this.escapeCsv('TOTAL ASSETS'), '""', '""', '""', report.assets.totalAssets].join(','));
    rows.push('');

    // Current Liabilities
    for (const acc of report.liabilities.currentLiabilities) {
      rows.push([
        this.escapeCsv('Liabilities'),
        this.escapeCsv('Current Liabilities'),
        this.escapeCsv(acc.code),
        this.escapeCsv(acc.name),
        this.escapeCsv(acc.classification),
        acc.balance
      ].join(','));
    }
    rows.push([this.escapeCsv('Liabilities'), this.escapeCsv('Total Current Liabilities'), '""', '""', '""', report.liabilities.totalCurrentLiabilities].join(','));

    // Long Term Liabilities
    for (const acc of report.liabilities.longTermLiabilities) {
      rows.push([
        this.escapeCsv('Liabilities'),
        this.escapeCsv('Long-Term Liabilities'),
        this.escapeCsv(acc.code),
        this.escapeCsv(acc.name),
        this.escapeCsv(acc.classification),
        acc.balance
      ].join(','));
    }
    rows.push([this.escapeCsv('Liabilities'), this.escapeCsv('Total Long-Term Liabilities'), '""', '""', '""', report.liabilities.totalLongTermLiabilities].join(','));
    rows.push([this.escapeCsv('Liabilities'), this.escapeCsv('TOTAL LIABILITIES'), '""', '""', '""', report.liabilities.totalLiabilities].join(','));
    rows.push('');

    // Equity
    for (const acc of report.equity.equityAccounts) {
      rows.push([
        this.escapeCsv('Equity'),
        this.escapeCsv('Contributed / Other Equity'),
        this.escapeCsv(acc.code),
        this.escapeCsv(acc.name),
        this.escapeCsv(acc.classification),
        acc.balance
      ].join(','));
    }
    rows.push([this.escapeCsv('Equity'), this.escapeCsv('Retained Earnings (Prior)'), '""', '""', '""', report.equity.retainedEarningsPrior].join(','));
    rows.push([this.escapeCsv('Equity'), this.escapeCsv('Net Income (Current Period)'), '""', '""', '""', report.equity.currentPeriodNetIncome].join(','));
    rows.push([this.escapeCsv('Equity'), this.escapeCsv('TOTAL EQUITY'), '""', '""', '""', report.equity.totalEquity].join(','));
    rows.push('');

    // Total Liabilities & Equity
    rows.push([this.escapeCsv('Summary'), this.escapeCsv('TOTAL LIABILITIES & EQUITY'), '""', '""', '""', report.totalLiabilitiesAndEquity].join(','));
    rows.push([this.escapeCsv('Summary'), this.escapeCsv('VARIANCE (Equilibrium Check)'), '""', '""', '""', report.variance].join(','));

    return rows.join('\r\n');
  }

  async exportBalanceSheetPdf(businessId: string, asOfDate?: Date | string): Promise<Buffer> {
    const header = await this.getBusinessHeader(businessId);
    const dateObj = asOfDate ? new Date(asOfDate) : undefined;
    const report = await financialReportingService.getBalanceSheet(businessId, dateObj);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
        const buffers: Buffer[] = [];

        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));

        this.renderPdfHeader(doc, header, 'STATEMENT OF FINANCIAL POSITION', `As of ${new Date(report.asOfDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);

        const currency = report.currency;

        // Equilibrium Indicator Badge
        doc.moveDown(0.5);
        if (report.isBalanced) {
          doc.fillColor('#059669').fontSize(9).text(`[✓] EQUILIBRIUM VERIFIED: Assets = Liabilities + Equity (Variance: 0.00)`, { align: 'right' });
        } else {
          doc.fillColor('#dc2626').fontSize(9).text(`[!] UNBALANCED: Variance of ${currency} ${report.variance}`, { align: 'right' });
        }
        doc.moveDown(0.5);

        // Section: ASSETS
        this.renderSectionHeader(doc, '1. ASSETS');
        this.renderSubSectionHeader(doc, 'Current Assets');
        for (const row of report.assets.currentAssets) {
          this.renderAccountRow(doc, row.code, row.name, row.balance, currency);
        }
        this.renderSubTotalRow(doc, 'Total Current Assets', report.assets.totalCurrentAssets, currency);

        if (report.assets.nonCurrentAssets.length > 0) {
          this.renderSubSectionHeader(doc, 'Non-Current Assets');
          for (const row of report.assets.nonCurrentAssets) {
            this.renderAccountRow(doc, row.code, row.name, row.balance, currency);
          }
          this.renderSubTotalRow(doc, 'Total Non-Current Assets', report.assets.totalNonCurrentAssets, currency);
        }
        this.renderGrandTotalRow(doc, 'TOTAL ASSETS', report.assets.totalAssets, currency);

        doc.moveDown(1);

        // Section: LIABILITIES
        this.renderSectionHeader(doc, '2. LIABILITIES');
        this.renderSubSectionHeader(doc, 'Current Liabilities');
        for (const row of report.liabilities.currentLiabilities) {
          this.renderAccountRow(doc, row.code, row.name, row.balance, currency);
        }
        this.renderSubTotalRow(doc, 'Total Current Liabilities', report.liabilities.totalCurrentLiabilities, currency);

        if (report.liabilities.longTermLiabilities.length > 0) {
          this.renderSubSectionHeader(doc, 'Long-Term Liabilities');
          for (const row of report.liabilities.longTermLiabilities) {
            this.renderAccountRow(doc, row.code, row.name, row.balance, currency);
          }
          this.renderSubTotalRow(doc, 'Total Long-Term Liabilities', report.liabilities.totalLongTermLiabilities, currency);
        }
        this.renderGrandTotalRow(doc, 'TOTAL LIABILITIES', report.liabilities.totalLiabilities, currency);

        doc.moveDown(1);

        // Section: EQUITY
        this.renderSectionHeader(doc, '3. EQUITY');
        for (const row of report.equity.equityAccounts) {
          this.renderAccountRow(doc, row.code, row.name, row.balance, currency);
        }
        this.renderAccountRow(doc, 'RET-PRIOR', 'Retained Earnings (Prior)', report.equity.retainedEarningsPrior, currency);
        this.renderAccountRow(doc, 'NET-INC', 'Net Income (Current Period)', report.equity.currentPeriodNetIncome, currency);
        this.renderGrandTotalRow(doc, 'TOTAL EQUITY', report.equity.totalEquity, currency);

        doc.moveDown(1);

        // Total Liabilities & Equity
        this.renderGrandTotalRow(doc, 'TOTAL LIABILITIES & EQUITY', report.totalLiabilitiesAndEquity, currency, true);

        // Stamp Footers with Checksum across all pages
        this.renderFooters(doc, 'Balance Sheet');

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // =========================================================================
  // 2. PROFIT & LOSS EXPORTS (PDF & CSV)
  // =========================================================================

  async exportProfitAndLossCsv(businessId: string, filters?: DateRangeFilters): Promise<string> {
    const header = await this.getBusinessHeader(businessId);
    const start = filters?.startDate ? new Date(filters.startDate) : undefined;
    const end = filters?.endDate ? new Date(filters.endDate) : undefined;
    const report = await financialReportingService.getProfitAndLoss(businessId, start, end);

    const rows: string[] = [];
    rows.push(this.escapeCsv(`STATEMENT OF PROFIT OR LOSS (INCOME STATEMENT)`));
    rows.push(`${this.escapeCsv('Business:')},${this.escapeCsv(header.legalName)}`);
    rows.push(`${this.escapeCsv('Period:')},${this.escapeCsv(`${report.startDate} to ${report.endDate}`)}`);
    rows.push(`${this.escapeCsv('Reporting Currency:')},${this.escapeCsv(report.currency)}`);
    rows.push(`${this.escapeCsv('Gross Margin:')},${this.escapeCsv(report.grossMarginPercentage)}`);
    rows.push(`${this.escapeCsv('Net Margin:')},${this.escapeCsv(report.netMarginPercentage)}`);
    rows.push('');

    // Column Headers
    rows.push([
      this.escapeCsv('Category'),
      this.escapeCsv('Account Code'),
      this.escapeCsv('Account Name'),
      this.escapeCsv('Classification'),
      this.escapeCsv(`Amount (${report.currency})`)
    ].join(','));

    // Revenue
    for (const acc of report.revenue.operatingRevenue) {
      rows.push([this.escapeCsv('Operating Revenue'), this.escapeCsv(acc.code), this.escapeCsv(acc.name), this.escapeCsv(acc.classification), acc.balance].join(','));
    }
    for (const acc of report.revenue.otherIncome) {
      rows.push([this.escapeCsv('Other Income'), this.escapeCsv(acc.code), this.escapeCsv(acc.name), this.escapeCsv(acc.classification), acc.balance].join(','));
    }
    rows.push([this.escapeCsv('Total Revenue'), '""', '""', '""', report.revenue.totalRevenue].join(','));
    rows.push('');

    // Cost of Goods Sold
    for (const acc of report.costOfGoodsSold.cogsAccounts) {
      rows.push([this.escapeCsv('Cost of Goods Sold'), this.escapeCsv(acc.code), this.escapeCsv(acc.name), this.escapeCsv(acc.classification), acc.balance].join(','));
    }
    rows.push([this.escapeCsv('Total Cost of Goods Sold'), '""', '""', '""', report.costOfGoodsSold.totalCogs].join(','));
    rows.push([this.escapeCsv('GROSS PROFIT'), '""', '""', '""', report.grossProfit].join(','));
    rows.push('');

    // Operating Expenses
    for (const acc of report.operatingExpenses.expenseAccounts) {
      rows.push([this.escapeCsv('Operating Expenses'), this.escapeCsv(acc.code), this.escapeCsv(acc.name), this.escapeCsv(acc.classification), acc.balance].join(','));
    }
    rows.push([this.escapeCsv('Total Operating Expenses'), '""', '""', '""', report.operatingExpenses.totalOperatingExpenses].join(','));
    rows.push([this.escapeCsv('NET OPERATING INCOME'), '""', '""', '""', report.netOperatingIncome].join(','));
    rows.push([this.escapeCsv('NET INCOME'), '""', '""', '""', report.netIncome].join(','));

    return rows.join('\r\n');
  }

  async exportProfitAndLossPdf(businessId: string, filters?: DateRangeFilters): Promise<Buffer> {
    const header = await this.getBusinessHeader(businessId);
    const start = filters?.startDate ? new Date(filters.startDate) : undefined;
    const end = filters?.endDate ? new Date(filters.endDate) : undefined;
    const report = await financialReportingService.getProfitAndLoss(businessId, start, end);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
        const buffers: Buffer[] = [];

        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));

        const startStr = new Date(report.startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        const endStr = new Date(report.endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

        this.renderPdfHeader(doc, header, 'STATEMENT OF PROFIT OR LOSS', `For the Period ${startStr} — ${endStr}`);

        const currency = report.currency;

        // Revenue Section
        this.renderSectionHeader(doc, '1. OPERATING REVENUE');
        for (const row of report.revenue.operatingRevenue) {
          this.renderAccountRow(doc, row.code, row.name, row.balance, currency);
        }
        if (report.revenue.otherIncome.length > 0) {
          this.renderSubSectionHeader(doc, 'Other Income');
          for (const row of report.revenue.otherIncome) {
            this.renderAccountRow(doc, row.code, row.name, row.balance, currency);
          }
        }
        this.renderSubTotalRow(doc, 'Total Revenue', report.revenue.totalRevenue, currency);

        doc.moveDown(0.8);

        // COGS Section
        this.renderSectionHeader(doc, '2. COST OF GOODS SOLD (COGS)');
        for (const row of report.costOfGoodsSold.cogsAccounts) {
          this.renderAccountRow(doc, row.code, row.name, row.balance, currency);
        }
        this.renderSubTotalRow(doc, 'Total Cost of Goods Sold', report.costOfGoodsSold.totalCogs, currency);

        doc.moveDown(0.5);
        this.renderHighlightRow(doc, `GROSS PROFIT (Margin: ${report.grossMarginPercentage})`, report.grossProfit, currency);

        doc.moveDown(0.8);

        // Operating Expenses
        this.renderSectionHeader(doc, '3. OPERATING EXPENSES');
        for (const row of report.operatingExpenses.expenseAccounts) {
          this.renderAccountRow(doc, row.code, row.name, row.balance, currency);
        }
        this.renderSubTotalRow(doc, 'Total Operating Expenses', report.operatingExpenses.totalOperatingExpenses, currency);

        doc.moveDown(0.8);
        this.renderGrandTotalRow(doc, `NET INCOME / (LOSS) (Net Margin: ${report.netMarginPercentage})`, report.netIncome, currency, true);

        this.renderFooters(doc, 'Profit & Loss');
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // =========================================================================
  // 3. TRIAL BALANCE EXPORTS (PDF & CSV)
  // =========================================================================

  async exportTrialBalanceCsv(businessId: string, asOfDate?: Date | string): Promise<string> {
    const header = await this.getBusinessHeader(businessId);
    const dateObj = asOfDate ? new Date(asOfDate) : new Date();
    const tb = await ledgerService.getTrialBalance(businessId, dateObj);

    const rows: string[] = [];
    rows.push(this.escapeCsv(`GENERAL LEDGER TRIAL BALANCE`));
    rows.push(`${this.escapeCsv('Business:')},${this.escapeCsv(header.legalName)}`);
    rows.push(`${this.escapeCsv('As of Date:')},${this.escapeCsv(tb.asOfDate)}`);
    rows.push(`${this.escapeCsv('Status:')},${this.escapeCsv(tb.isBalanced ? 'EQUILIBRIUM VERIFIED' : `OUT OF BALANCE (Difference: ${tb.difference})`)}`);
    rows.push('');

    // Column Headers
    rows.push([
      this.escapeCsv('Account Code'),
      this.escapeCsv('Account Name'),
      this.escapeCsv('Type'),
      this.escapeCsv('Classification'),
      this.escapeCsv('Normal Balance'),
      this.escapeCsv(`Debit (${header.currency})`),
      this.escapeCsv(`Credit (${header.currency})`)
    ].join(','));

    for (const r of tb.rows) {
      rows.push([
        this.escapeCsv(r.code),
        this.escapeCsv(r.name),
        this.escapeCsv(r.type),
        this.escapeCsv(r.classification),
        this.escapeCsv(r.normalBalance),
        r.netDebit,
        r.netCredit
      ].join(','));
    }

    rows.push('');
    rows.push([
      this.escapeCsv('TOTALS'),
      '""',
      '""',
      '""',
      '""',
      tb.totalDebit,
      tb.totalCredit
    ].join(','));
    rows.push([
      this.escapeCsv('VARIANCE / DIFFERENCE'),
      '""',
      '""',
      '""',
      '""',
      tb.difference,
      '""'
    ].join(','));

    return rows.join('\r\n');
  }

  async exportTrialBalancePdf(businessId: string, asOfDate?: Date | string): Promise<Buffer> {
    const header = await this.getBusinessHeader(businessId);
    const dateObj = asOfDate ? new Date(asOfDate) : new Date();
    const tb = await ledgerService.getTrialBalance(businessId, dateObj);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
        const buffers: Buffer[] = [];

        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));

        this.renderPdfHeader(doc, header, 'GENERAL LEDGER TRIAL BALANCE', `As of ${dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);

        const currency = header.currency;

        doc.moveDown(0.5);
        if (tb.isBalanced) {
          doc.fillColor('#059669').fontSize(9).text(`[✓] EQUILIBRIUM MAINTAINED: Total Debits == Total Credits (Difference: 0.00)`, { align: 'right' });
        } else {
          doc.fillColor('#dc2626').fontSize(9).text(`[!] UNBALANCED: Debit/Credit Difference: ${currency} ${tb.difference}`, { align: 'right' });
        }
        doc.moveDown(0.5);

        // Table Header
        const startX = 40;
        const width = 515;
        doc.fillColor('#334155').fontSize(8).font('Helvetica-Bold');
        doc.text('CODE', startX, doc.y, { width: 50, align: 'left' });
        doc.text('ACCOUNT NAME', startX + 55, doc.y - 10, { width: 175, align: 'left' });
        doc.text('TYPE', startX + 235, doc.y - 10, { width: 80, align: 'left' });
        doc.text(`DEBIT (${currency})`, startX + 320, doc.y - 10, { width: 95, align: 'right' });
        doc.text(`CREDIT (${currency})`, startX + 420, doc.y - 10, { width: 95, align: 'right' });

        doc.moveTo(startX, doc.y + 4).lineTo(startX + width, doc.y + 4).strokeColor('#cbd5e1').lineWidth(1).stroke();
        doc.moveDown(0.6);

        // Table Rows
        for (const r of tb.rows) {
          // If debit and credit are both 0.00, we still print or display cleanly
          const curY = doc.y;
          if (curY > 750) {
            doc.addPage();
          }

          const y = doc.y;
          doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
          doc.text(r.code, startX, y, { width: 50, align: 'left' });
          doc.text(r.name, startX + 55, y, { width: 175, align: 'left' });
          doc.fillColor('#64748b').text(r.type, startX + 235, y, { width: 80, align: 'left' });

          doc.fillColor('#0f172a');
          doc.text(r.netDebit !== '0.00' ? r.netDebit : '-', startX + 320, y, { width: 95, align: 'right' });
          doc.text(r.netCredit !== '0.00' ? r.netCredit : '-', startX + 420, y, { width: 95, align: 'right' });

          doc.moveDown(0.3);
        }

        // Totals Row
        doc.moveDown(0.5);
        const totY = doc.y;
        doc.moveTo(startX, totY).lineTo(startX + width, totY).strokeColor('#0f172a').lineWidth(1).stroke();
        doc.moveDown(0.4);

        const sumY = doc.y;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
        doc.text('TOTAL TRIAL BALANCE', startX, sumY, { width: 315, align: 'left' });
        doc.text(tb.totalDebit, startX + 320, sumY, { width: 95, align: 'right' });
        doc.text(tb.totalCredit, startX + 420, sumY, { width: 95, align: 'right' });

        const endY = doc.y + 4;
        doc.moveTo(startX, endY).lineTo(startX + width, endY).strokeColor('#0f172a').lineWidth(1).stroke();
        doc.moveTo(startX, endY + 2).lineTo(startX + width, endY + 2).strokeColor('#0f172a').lineWidth(1).stroke();

        this.renderFooters(doc, 'Trial Balance');
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // =========================================================================
  // 4. CASH FLOW STATEMENT EXPORTS (PDF & CSV)
  // =========================================================================

  async exportCashFlowCsv(businessId: string, filters?: DateRangeFilters): Promise<string> {
    const header = await this.getBusinessHeader(businessId);
    const start = filters?.startDate ? new Date(filters.startDate) : undefined;
    const end = filters?.endDate ? new Date(filters.endDate) : undefined;
    const cf = await financialReportingService.getCashFlowStatement(businessId, start, end);

    const rows: string[] = [];
    rows.push(this.escapeCsv(`STATEMENT OF CASH FLOWS (DIRECT METHOD)`));
    rows.push(`${this.escapeCsv('Business:')},${this.escapeCsv(header.legalName)}`);
    rows.push(`${this.escapeCsv('Period:')},${this.escapeCsv(`${cf.startDate} to ${cf.endDate}`)}`);
    rows.push(`${this.escapeCsv('Reporting Currency:')},${this.escapeCsv(cf.currency)}`);
    rows.push('');

    rows.push([this.escapeCsv('Activity Category'), this.escapeCsv(`Amount (${cf.currency})`)].join(','));
    rows.push([this.escapeCsv('Opening Cash Balance'), cf.openingCashBalance].join(','));
    rows.push([this.escapeCsv('Cash Inflow from Customers'), cf.operatingActivities.cashFromCustomers].join(','));
    rows.push([this.escapeCsv('Cash Outflow for Vendors & Expenses'), cf.operatingActivities.cashPaidForExpensesAndVendors].join(','));
    rows.push([this.escapeCsv('Net Cash from Operating Activities'), cf.operatingActivities.netOperatingCashFlow].join(','));
    rows.push([this.escapeCsv('Net Cash from Investing Activities'), cf.investingActivities.netInvestingCashFlow].join(','));
    rows.push([this.escapeCsv('Net Cash from Financing Activities'), cf.financingActivities.netFinancingCashFlow].join(','));
    rows.push([this.escapeCsv('Net Change in Cash'), cf.netCashFlow].join(','));
    rows.push([this.escapeCsv('Closing Cash Balance'), cf.closingCashBalance].join(','));

    return rows.join('\r\n');
  }

  async exportCashFlowPdf(businessId: string, filters?: DateRangeFilters): Promise<Buffer> {
    const header = await this.getBusinessHeader(businessId);
    const start = filters?.startDate ? new Date(filters.startDate) : undefined;
    const end = filters?.endDate ? new Date(filters.endDate) : undefined;
    const cf = await financialReportingService.getCashFlowStatement(businessId, start, end);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
        const buffers: Buffer[] = [];

        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));

        const startStr = new Date(cf.startDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        const endStr = new Date(cf.endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

        this.renderPdfHeader(doc, header, 'STATEMENT OF CASH FLOWS', `For the Period ${startStr} — ${endStr}`);

        const currency = cf.currency;

        this.renderAccountRow(doc, 'OPEN-CASH', 'Opening Cash & Equivalents Balance', cf.openingCashBalance, currency);
        doc.moveDown(0.8);

        this.renderSectionHeader(doc, '1. OPERATING ACTIVITIES');
        this.renderAccountRow(doc, 'CASH-IN', 'Cash Collections from Customers', cf.operatingActivities.cashFromCustomers, currency);
        this.renderAccountRow(doc, 'CASH-OUT', 'Cash Disbursements for Expenses & Vendors', cf.operatingActivities.cashPaidForExpensesAndVendors, currency);
        this.renderSubTotalRow(doc, 'Net Cash Flow from Operating Activities', cf.operatingActivities.netOperatingCashFlow, currency);

        doc.moveDown(0.8);
        this.renderSectionHeader(doc, '2. INVESTING ACTIVITIES');
        this.renderSubTotalRow(doc, 'Net Cash Flow from Investing Activities', cf.investingActivities.netInvestingCashFlow, currency);

        doc.moveDown(0.8);
        this.renderSectionHeader(doc, '3. FINANCING ACTIVITIES');
        this.renderSubTotalRow(doc, 'Net Cash Flow from Financing Activities', cf.financingActivities.netFinancingCashFlow, currency);

        doc.moveDown(1);
        this.renderHighlightRow(doc, 'NET INCREASE / (DECREASE) IN CASH', cf.netCashFlow, currency);

        doc.moveDown(0.5);
        this.renderGrandTotalRow(doc, 'CLOSING CASH & EQUIVALENTS BALANCE', cf.closingCashBalance, currency, true);

        this.renderFooters(doc, 'Cash Flow Statement');
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // =========================================================================
  // 5. BANK RECONCILIATION STATEMENT EXPORTS (PDF & CSV)
  // =========================================================================

  async exportReconciliationCsv(businessId: string, bankFeedAccountId: string, asOfDate?: Date | string): Promise<string> {
    const header = await this.getBusinessHeader(businessId);
    const dateObj = asOfDate ? new Date(asOfDate) : new Date();
    const recon = await bankReconciliationService.getReconciliationReport(businessId, bankFeedAccountId, dateObj);

    const rows: string[] = [];
    rows.push(this.escapeCsv(`BANK RECONCILIATION STATEMENT`));
    rows.push(`${this.escapeCsv('Business:')},${this.escapeCsv(header.legalName)}`);
    rows.push(`${this.escapeCsv('Institution:')},${this.escapeCsv(recon.bankFeedAccount.institutionName)}`);
    rows.push(`${this.escapeCsv('Account Mask:')},${this.escapeCsv(recon.bankFeedAccount.accountNumberMask)}`);
    rows.push(`${this.escapeCsv('GL Linked Account:')},${this.escapeCsv(`${recon.bankFeedAccount.glAccount.code} - ${recon.bankFeedAccount.glAccount.name}`)}`);
    rows.push(`${this.escapeCsv('As of Date:')},${this.escapeCsv(recon.asOfDate)}`);
    rows.push(`${this.escapeCsv('Reconciliation Status:')},${this.escapeCsv(recon.summary.isReconciled ? 'PERFECTLY RECONCILED' : `OUT OF BALANCE (Variance: ${recon.summary.variance})`)}`);
    rows.push('');

    rows.push([this.escapeCsv('Reconciliation Item'), this.escapeCsv(`Amount (${recon.bankFeedAccount.currency})`)].join(','));
    rows.push([this.escapeCsv('Bank Statement Ending Balance'), recon.summary.statementBalance].join(','));
    rows.push([this.escapeCsv('General Ledger Ending Balance'), recon.summary.ledgerBalance].join(','));
    rows.push([this.escapeCsv('Variance / Difference'), recon.summary.variance].join(','));
    rows.push('');
    rows.push([this.escapeCsv('Matched Bank Total'), recon.breakdown.matchedBankTotal].join(','));
    rows.push([this.escapeCsv('Unmatched Bank Deposits (In-Transit)'), recon.breakdown.unmatchedBankDeposits].join(','));
    rows.push([this.escapeCsv('Unmatched Bank Withdrawals (Uncleared)'), recon.breakdown.unmatchedBankWithdrawals].join(','));
    rows.push([this.escapeCsv('Unmatched General Ledger Debits'), recon.breakdown.unmatchedGlDebits].join(','));
    rows.push([this.escapeCsv('Unmatched General Ledger Credits'), recon.breakdown.unmatchedGlCredits].join(','));

    return rows.join('\r\n');
  }

  async exportReconciliationPdf(businessId: string, bankFeedAccountId: string, asOfDate?: Date | string): Promise<Buffer> {
    const header = await this.getBusinessHeader(businessId);
    const dateObj = asOfDate ? new Date(asOfDate) : new Date();
    const recon = await bankReconciliationService.getReconciliationReport(businessId, bankFeedAccountId, dateObj);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
        const buffers: Buffer[] = [];

        doc.on('data', (chunk) => buffers.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', (err) => reject(err));

        const cutoffStr = new Date(recon.asOfDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        this.renderPdfHeader(doc, header, 'BANK RECONCILIATION STATEMENT', `As of ${cutoffStr}`);

        const currency = recon.bankFeedAccount.currency || header.currency;

        // Institution & Account meta box
        doc.fillColor('#1e293b').fontSize(9).font('Helvetica-Bold');
        doc.text(`Bank Institution: ${recon.bankFeedAccount.institutionName} (${recon.bankFeedAccount.accountNumberMask})`);
        doc.text(`General Ledger Mapping: ${recon.bankFeedAccount.glAccount.code} — ${recon.bankFeedAccount.glAccount.name}`);
        doc.moveDown(0.5);

        // Status badge
        if (recon.summary.isReconciled) {
          doc.fillColor('#059669').fontSize(9).text(`[✓] ZERO-VARIANCE EQUILIBRIUM: Bank Statement and GL Ledger are 100% Reconciled`, { align: 'right' });
        } else {
          doc.fillColor('#dc2626').fontSize(9).text(`[!] UNRECONCILED: Variance of ${currency} ${recon.summary.variance}`, { align: 'right' });
        }
        doc.moveDown(0.5);

        // Section A: Statement vs Ledger
        this.renderSectionHeader(doc, '1. CORE BALANCES');
        this.renderAccountRow(doc, 'BANK-STMT', 'Bank Statement Balance', recon.summary.statementBalance, currency);
        this.renderAccountRow(doc, 'GL-LEDGER', 'General Ledger Book Balance', recon.summary.ledgerBalance, currency);
        this.renderGrandTotalRow(doc, 'UNADJUSTED RECONCILIATION VARIANCE', recon.summary.variance, currency, recon.summary.isReconciled);

        doc.moveDown(1);

        // Section B: Reconciling In-Transit Items
        this.renderSectionHeader(doc, '2. IN-TRANSIT & OUTSTANDING RECONCILING ITEMS');
        this.renderAccountRow(doc, 'UNM-DEP', 'Unmatched Bank Deposits (In-Transit Deposits)', recon.breakdown.unmatchedBankDeposits, currency);
        this.renderAccountRow(doc, 'UNM-WTH', 'Unmatched Bank Withdrawals (Outstanding Debits)', recon.breakdown.unmatchedBankWithdrawals, currency);
        this.renderAccountRow(doc, 'UNM-GL-DR', 'Unmatched GL Debits (Deposits in books not in bank)', recon.breakdown.unmatchedGlDebits, currency);
        this.renderAccountRow(doc, 'UNM-GL-CR', 'Unmatched GL Credits (Checks/Disbursements outstanding)', recon.breakdown.unmatchedGlCredits, currency);
        this.renderSubTotalRow(doc, 'Total Matched Bank Activity', recon.breakdown.matchedBankTotal, currency);

        doc.moveDown(1);

        // Section C: Verification Metrics
        this.renderSectionHeader(doc, '3. AUDIT TRANSACTION METRICS');
        doc.font('Helvetica').fontSize(9).fillColor('#334155');
        doc.text(`Total Bank Transactions: ${recon.counts.totalBankTransactions}`);
        doc.text(`Matched Transactions: ${recon.counts.matchedCount}`);
        doc.text(`Unmatched Transactions: ${recon.counts.unmatchedCount}`);
        doc.text(`Excluded Non-Operating Items: ${recon.counts.excludedCount}`);

        this.renderFooters(doc, 'Bank Reconciliation');
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // =========================================================================
  // PDF RENDERING PRIMITIVES
  // =========================================================================

  private renderPdfHeader(doc: any, header: BusinessHeaderInfo, title: string, subtitle: string) {
    const startX = 40;
    const width = 515;

    // Company Name
    doc.fillColor('#0f172a').fontSize(15).font('Helvetica-Bold');
    doc.text(header.legalName.toUpperCase(), startX, 40, { width, align: 'left' });

    // Address & Tax ID
    doc.fillColor('#64748b').fontSize(8).font('Helvetica');
    const metaParts = [header.address, header.taxId ? `Tax ID: ${header.taxId}` : ''].filter(Boolean);
    if (metaParts.length > 0) {
      doc.text(metaParts.join('  •  '), startX, doc.y, { width, align: 'left' });
    }

    // Top rule
    doc.moveDown(0.4);
    doc.moveTo(startX, doc.y).lineTo(startX + width, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
    doc.moveDown(0.6);

    // Document Title
    doc.fillColor('#1e293b').fontSize(13).font('Helvetica-Bold');
    doc.text(title, startX, doc.y, { width, align: 'center' });

    // Subtitle & Currency
    doc.fillColor('#64748b').fontSize(9).font('Helvetica');
    doc.text(`${subtitle}  |  Currency: ${header.currency}`, startX, doc.y, { width, align: 'center' });

    doc.moveDown(0.4);
    doc.moveTo(startX, doc.y).lineTo(startX + width, doc.y).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    doc.moveDown(0.6);
  }

  private renderSectionHeader(doc: any, title: string) {
    const startX = 40;
    const width = 515;
    doc.fillColor('#1e293b').fontSize(10).font('Helvetica-Bold');
    doc.text(title, startX, doc.y, { width });
    doc.moveTo(startX, doc.y + 2).lineTo(startX + width, doc.y + 2).strokeColor('#cbd5e1').lineWidth(1).stroke();
    doc.moveDown(0.4);
  }

  private renderSubSectionHeader(doc: any, title: string) {
    doc.fillColor('#475569').fontSize(8.5).font('Helvetica-Bold');
    doc.text(`   ${title}`);
    doc.moveDown(0.2);
  }

  private renderAccountRow(doc: any, code: string, name: string, balance: string, currency: string) {
    const startX = 40;
    const width = 515;
    const y = doc.y;

    if (y > 750) {
      doc.addPage();
    }

    const curY = doc.y;
    doc.font('Helvetica').fontSize(8.5).fillColor('#64748b');
    doc.text(code, startX + 15, curY, { width: 65, align: 'left' });

    doc.fillColor('#0f172a');
    doc.text(name, startX + 85, curY, { width: 280, align: 'left' });

    doc.text(this.formatAmount(balance, currency), startX + 370, curY, { width: 145, align: 'right' });
    doc.moveDown(0.25);
  }

  private renderSubTotalRow(doc: any, label: string, total: string, currency: string) {
    const startX = 40;
    const width = 515;
    const y = doc.y;

    doc.moveTo(startX + 370, y).lineTo(startX + width, y).strokeColor('#94a3b8').lineWidth(0.5).stroke();
    doc.moveDown(0.3);

    const curY = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#334155');
    doc.text(label, startX + 85, curY, { width: 280, align: 'left' });
    doc.text(this.formatAmount(total, currency), startX + 370, curY, { width: 145, align: 'right' });
    doc.moveDown(0.4);
  }

  private renderGrandTotalRow(doc: any, label: string, total: string, currency: string, isDoubleLine = false) {
    const startX = 40;
    const width = 515;
    const y = doc.y;

    doc.moveTo(startX, y).lineTo(startX + width, y).strokeColor('#0f172a').lineWidth(1).stroke();
    doc.moveDown(0.4);

    const curY = doc.y;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a');
    doc.text(label, startX + 15, curY, { width: 350, align: 'left' });
    doc.text(this.formatAmount(total, currency), startX + 370, curY, { width: 145, align: 'right' });

    const endY = doc.y + 3;
    if (isDoubleLine) {
      doc.moveTo(startX, endY).lineTo(startX + width, endY).strokeColor('#0f172a').lineWidth(1).stroke();
      doc.moveTo(startX, endY + 2.5).lineTo(startX + width, endY + 2.5).strokeColor('#0f172a').lineWidth(1).stroke();
    } else {
      doc.moveTo(startX, endY).lineTo(startX + width, endY).strokeColor('#0f172a').lineWidth(1).stroke();
    }
    doc.moveDown(0.6);
  }

  private renderHighlightRow(doc: any, label: string, total: string, currency: string) {
    const startX = 40;
    const width = 515;
    const curY = doc.y;

    doc.rect(startX, curY - 2, width, 18).fill('#f1f5f9');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
    doc.text(label, startX + 10, curY + 2, { width: 350, align: 'left' });
    doc.text(this.formatAmount(total, currency), startX + 370, curY + 2, { width: 135, align: 'right' });
    doc.moveDown(0.8);
  }

  private renderFooters(doc: any, reportName: string) {
    const range = doc.bufferedPageRange();
    const hash = crypto.randomBytes(6).toString('hex').toUpperCase();

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footerY = 800;

      doc.moveTo(40, footerY - 5).lineTo(555, footerY - 5).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      doc.font('Helvetica').fontSize(7).fillColor('#94a3b8');

      doc.text(
        `CONFIDENTIAL  •  ${reportName.toUpperCase()}  •  Generated: ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC  •  SEAL: ${hash}`,
        40,
        footerY,
        { width: 380, align: 'left' }
      );

      doc.text(
        `Page ${i + 1} of ${range.count}`,
        430,
        footerY,
        { width: 125, align: 'right' }
      );
    }
  }
}

export const financialExportService = new FinancialExportService();
