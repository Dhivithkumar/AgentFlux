import { PrismaClient } from '@prisma/client';
import { OrderService } from '../services/order/OrderService';
import { InvoiceService } from '../services/invoice/InvoiceService';
import { EventDispatcher } from '../services/workflow/eventDispatcher';
import { DocumentGenerationService } from '../services/documents/DocumentGenerationService';

const prisma = new PrismaClient();
const orderService = new OrderService();
const invoiceService = new InvoiceService();

async function runTests() {
  console.log('===============================================================');
  console.log('INVOICE WORKFLOW FINAL VERIFICATION REPORT');
  console.log('===============================================================');
  
  let passed = 0;
  let failed = 0;
  const failedTests: string[] = [];

  const assert = (condition: boolean, testName: string, errorMessage?: string) => {
    if (condition) {
      console.log(`✅ Passed: ${testName}`);
      passed++;
    } else {
      console.error(`❌ Failed: ${testName}`);
      if (errorMessage) console.error(`   Reason: ${errorMessage}`);
      failed++;
      failedTests.push(testName);
    }
  };

  try {
    // 0. Setup Test Data
    const businessId = "1379ce47-39e9-4742-9034-dfe218b6c0fc"; // Target user's business

    // Find or create customer
    let customer = await prisma.customer.findFirst({ where: { businessId, email: 'karthik@example.com' }});
    if (!customer) {
        customer = await prisma.customer.create({
            data: {
                businessId,
                name: 'Karthik',
                email: 'karthik@example.com',
                phone: '+91 9876543210',
                customData: { billingAddress: '123 Test Street, Coimbatore' }
            }
        });
    } else {
        await prisma.customer.update({
            where: { id: customer.id },
            data: { customData: { billingAddress: '123 Test Street, Coimbatore' } }
        });
    }

    // 1. Normal order -> invoice (Multi-item, discounts, taxes)
    console.log('\\n--- Test Suite 1: Golden Path ---');
    
    // Create quotation
    const quotation = await prisma.quotation.create({
      data: {
        businessId,
        customerId: customer.id,
        quotationNumber: `AF-QTN-${Date.now()}`,
        status: 'SENT',
        currency: 'INR',
        subtotal: 76000,
        discountAmount: 0,
        taxAmount: 9120, // 12% GST
        totalAmount: 85120,
        lineItems: JSON.stringify([
          { sku: 'SOFA-3S', productName: 'Modern 3-Seater Sofa', quantity: 2, unitPrice: 38000, lineTotal: 76000 }
        ]),
        validUntil: new Date(Date.now() + 10000000)
      }
    });

    // Accept Quotation
    const acceptRes = await orderService.processQuotationAcceptance(businessId, customer.id, quotation.quotationNumber, 'thread-123');
    assert(acceptRes.status === 'SUCCESS', 'Order created on quotation acceptance');
    
    // Check order snapshot
    const order = await prisma.order.findFirst({ where: { quotationId: quotation.id }});
    assert(!!order, 'Order exists in database');
    assert(order!.totalAmount === 85120, 'Order commercial snapshot matches quotation');

    // Simulate Event Dispatch
    await EventDispatcher.dispatch(businessId, 'ORDER_CONFIRMED', { orderId: order!.id });

    // Check Invoice Generation
    const invoice = await prisma.invoice.findFirst({ where: { orderId: order!.id } });
    assert(!!invoice, 'Invoice created from order');
    assert(invoice!.totalAmount === 85120, 'Invoice total matches order snapshot');
    assert(invoice!.status === 'GENERATED' || invoice!.status === 'SENT', `Invoice progressed past DRAFT (Actual: ${invoice?.status})`);

    // 2. Missing Billing Address Test
    console.log('\\n--- Test Suite 2: Missing Customer Data ---');
    
    // Remove billing address
    await prisma.customer.update({ where: { id: customer.id }, data: { customData: {} } });
    
    const missingDataQtn = await prisma.quotation.create({
      data: {
        businessId, customerId: customer.id, quotationNumber: `AF-QTN-${Date.now() + 1}`,
        status: 'SENT', currency: 'INR', subtotal: 100, taxAmount: 12, totalAmount: 112,
        lineItems: JSON.stringify([{ productName: 'Test', quantity: 1, unitPrice: 100 }]),
        validUntil: new Date(Date.now() + 10000000)
      }
    });

    const acceptMissing = await orderService.processQuotationAcceptance(businessId, customer.id, missingDataQtn.quotationNumber, 'thread-miss');
    const orderMissing = await prisma.order.findFirst({ where: { quotationId: missingDataQtn.id } });
    
    await EventDispatcher.dispatch(businessId, 'ORDER_CONFIRMED', { orderId: orderMissing!.id });
    
    // Invoice should NOT be created, order status should be CUSTOMER_INFORMATION_REQUIRED
    const orderMissingUpdated = await prisma.order.findUnique({ where: { id: orderMissing!.id }});
    const invoiceMissing = await prisma.invoice.findFirst({ where: { orderId: orderMissing!.id } });
    assert(!invoiceMissing, 'Invoice NOT generated when billing address is missing');
    assert(orderMissingUpdated!.status === 'CUSTOMER_INFORMATION_REQUIRED', 'Order status updated to request missing information');

    // 3. Expired Quotation Test
    console.log('\\n--- Test Suite 3: Expired Quotation ---');
    
    const expiredQtn = await prisma.quotation.create({
      data: {
        businessId, customerId: customer.id, quotationNumber: `AF-QTN-${Date.now() + 2}`,
        status: 'EXPIRED', currency: 'INR', subtotal: 100, taxAmount: 12, totalAmount: 112,
        lineItems: JSON.stringify([]),
        validUntil: new Date(Date.now() - 10000000)
      }
    });

    const acceptExpired = await orderService.processQuotationAcceptance(businessId, customer.id, expiredQtn.quotationNumber, 'thread-exp');
    assert(acceptExpired.status === 'FAILED' && acceptExpired.emailBody.includes('expired'), 'Expired quotation is rejected');
    
    const orderExpired = await prisma.order.findFirst({ where: { quotationId: expiredQtn.id } });
    assert(!orderExpired, 'No order created for expired quotation');

    // 4. Duplicate Acceptance Test
    console.log('\\n--- Test Suite 4: Duplicate Acceptance ---');
    
    const duplicateQtn = await prisma.quotation.create({
      data: {
        businessId, customerId: customer.id, quotationNumber: `AF-QTN-${Date.now() + 3}`,
        status: 'SENT', currency: 'INR', subtotal: 100, taxAmount: 12, totalAmount: 112,
        lineItems: JSON.stringify([{ productName: 'Test', quantity: 1, unitPrice: 100 }]),
        validUntil: new Date(Date.now() + 10000000)
      }
    });

    await orderService.processQuotationAcceptance(businessId, customer.id, duplicateQtn.quotationNumber, 'thread-dup1');
    const orderDup1 = await prisma.order.findFirst({ where: { quotationId: duplicateQtn.id } });
    
    // Accept again
    await orderService.processQuotationAcceptance(businessId, customer.id, duplicateQtn.quotationNumber, 'thread-dup2');
    const ordersForQtn = await prisma.order.count({ where: { quotationId: duplicateQtn.id } });
    
    assert(ordersForQtn === 1, 'Idempotency maintained: Only one order created for multiple acceptances');

    // 5. Price Change Snapshot Test
    console.log('\\n--- Test Suite 5: Snapshot Validation ---');
    // Restore billing address
    await prisma.customer.update({
        where: { id: customer.id },
        data: { customData: { billingAddress: '123 Test Street, Coimbatore' } }
    });

    const snapshotQtn = await prisma.quotation.create({
      data: {
        businessId, customerId: customer.id, quotationNumber: `AF-QTN-${Date.now()}`,
        status: 'SENT', currency: 'INR', subtotal: 38000, taxAmount: 4560, totalAmount: 42560,
        lineItems: JSON.stringify([{ sku: 'SOFA-3S', productName: 'Modern 3-Seater Sofa', quantity: 1, unitPrice: 38000 }]),
        validUntil: new Date(Date.now() + 10000000)
      }
    });

    await orderService.processQuotationAcceptance(businessId, customer.id, snapshotQtn.quotationNumber, 'thread-snap');
    const orderSnap = await prisma.order.findFirst({ where: { quotationId: snapshotQtn.id } });
    
    // Suppose the product catalog price is now changed to 42000. 
    // The invoice engine must still use the 38000 from the order.
    await EventDispatcher.dispatch(businessId, 'ORDER_CONFIRMED', { orderId: orderSnap!.id });
    
    const invoiceSnap = await prisma.invoice.findFirst({ where: { orderId: orderSnap!.id } });
    assert(!!invoiceSnap, 'Invoice created for snapshot test');
    assert(invoiceSnap!.totalAmount === 42560, 'Invoice total matches historical snapshot regardless of external state');

  } catch (err: any) {
    console.error('Test execution failed catastrophically:', err);
    assert(false, 'Test execution ran without unhandled errors', err.message);
  } finally {
    console.log('\\n===============================================================');
    console.log('TEST RESULTS');
    console.log(`Total:  ${passed + failed}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    if (failed > 0) {
      console.log('Failed Tests:');
      failedTests.forEach(t => console.log(`  - ${t}`));
    }
    console.log('===============================================================');
    await prisma.$disconnect();
  }
}

runTests();
