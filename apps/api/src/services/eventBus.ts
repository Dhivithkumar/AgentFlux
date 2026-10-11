import { EventDispatcher } from './workflow/eventDispatcher';
import { ledgerSyncService } from './finance/LedgerSyncService';

export class EventBus {
  /**
   * Publish an event to the system.
   * Dispatches workflows and synchronises operational subledgers (invoices, payments).
   */
  static async publish(businessId: string, eventType: string, payload: any) {
    try {
      await EventDispatcher.dispatch(businessId, eventType, payload);
    } catch (err) {
      console.error(`Failed to dispatch event ${eventType} for business ${businessId}:`, err);
    }

    // Operational Double-Entry Ledger Synchronisation
    try {
      if (eventType === 'INVOICE_GENERATED' && payload?.invoiceId) {
        await ledgerSyncService.syncInvoiceToLedger(businessId, payload.invoiceId);
      } else if (eventType === 'PAYMENT_SUCCEEDED') {
        const paymentId = payload?.payment?.id || payload?.paymentId;
        if (paymentId) {
          await ledgerSyncService.syncPaymentToLedger(businessId, paymentId);
        }
      } else if (eventType === 'INVOICE_CANCELLED' && payload?.invoiceId) {
        await ledgerSyncService.syncInvoiceCancellationToLedger(
          businessId,
          payload.invoiceId,
          payload.reason || 'Invoice cancelled'
        );
      }
    } catch (ledgerErr) {
      console.error(
        `[EventBus] Finance ledger auto-sync warning for ${eventType} in ${businessId}:`,
        ledgerErr
      );
    }
  }
}
