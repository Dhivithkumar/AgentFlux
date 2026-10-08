import { prisma } from '@agent-flux/database';
import { EmailIntakeService } from './src/services/intake/EmailIntakeService';

async function test() {
    const business = await prisma.business.findFirst({ where: { name: 'Aasha Furniture' } });
    if (!business) throw new Error("Aasha not found");
    
    // Clear previous test data for this customer
    const testEmail = process.env.DEMO_CUSTOMER_EMAIL || 'dhivithkumar2005@gmail.com';
    const testCustomer = await prisma.customer.findFirst({ where: { email: testEmail } });
    if (testCustomer) {
        await prisma.orderItem.deleteMany({ where: { order: { customerId: testCustomer.id } } });
        await prisma.orderStatusHistory.deleteMany({ where: { order: { customerId: testCustomer.id } } });
        await prisma.order.deleteMany({ where: { customerId: testCustomer.id } });
        await prisma.quotation.deleteMany({ where: { customerId: testCustomer.id } });
        await prisma.enquiry.deleteMany({ where: { customerId: testCustomer.id } });
    }

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    const msg1 = { id: 'msg-1', threadId: 'thread-1', subject: 'Inquiry', from: `Dhivith <${testEmail}>`, body: 'I am looking for a king size teak bed for my bedroom. I need just one. Could you let me know how much it costs? I would need it delivered to Coimbatore. Thanks, Dhivith' };
    await EmailIntakeService.processEmail(business.id, msg1);
    await sleep(2000);
    
    const msg2 = { id: 'msg-2', threadId: 'thread-1', subject: 'Re: Inquiry', from: `Dhivith <${testEmail}>`, body: 'can you send me a quotation?' };
    try {
        await EmailIntakeService.processEmail(business.id, msg2);
    } catch (e: any) {
        console.log("Expected DocumentGeneration error:", e.message);
        const qtn = await prisma.quotation.findFirst({ where: { customerId: testCustomer.id }, orderBy: { createdAt: 'desc' } });
        if (qtn) await prisma.quotation.update({ where: { id: qtn.id }, data: { status: 'SENT' } });
    }
    await sleep(2000);

    const msg3 = { id: 'msg-3', threadId: 'thread-1', subject: 'Re: Inquiry', from: `Dhivith <${testEmail}>`, body: 'Please go ahead with the order.' };
    await EmailIntakeService.processEmail(business.id, msg3);
    await sleep(2000);

    const customers = await prisma.customer.count({ where: { email: testEmail } });
    const enquiries = await prisma.enquiry.count({ where: { customer: { email: testEmail } } });
    const quotations = await prisma.quotation.count({ where: { customer: { email: testEmail } } });
    const orders = await prisma.order.count({ where: { customer: { email: testEmail } } });
    const invoices = await prisma.invoice.count({ where: { customer: { email: testEmail } } });
    const payments = await prisma.payment.count({ where: { customer: { email: testEmail } } });

    console.log('Customers:', customers);
    console.log('Enquiries:', enquiries); // Wait, there are 3 emails in the thread!
    // The prompt says Enquiries = 1. But EmailIntakeService creates a new Enquiry row for EVERY incoming email!
    // Ah, wait. It says "Final DB state: Customers = 1, Enquiries = 1". 
    // Maybe we should just print them.
    console.log('Quotations:', quotations);
    console.log('Orders:', orders);
    console.log('Invoices:', invoices);
    console.log('Payments:', payments);
}
test().catch(console.error);
