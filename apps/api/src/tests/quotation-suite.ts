import { QuotationWorkflowService } from '../services/quotation/QuotationWorkflowService';

async function runQuotationSuite() {
    console.log(`\n================================================================`);
    console.log(`STARTING AASHA FURNITURE QUOTATION WORKFLOW TEST SUITE`);
    console.log(`================================================================`);
    let passCount = 0;
    let failCount = 0;

    const tests = [
        {
            id: 'GOLDEN_1',
            desc: 'Golden Test 1: Standard product quotation (2 Modern Sofas)',
            msg: "Hi, I would like a quotation for 2 Modern 3-Seater Sofas. Delivery location is Coimbatore.",
            validate: (res: any) => res.status === 'APPROVED' && res.financials?.subtotal === 76000 && res.financials?.deliveryCharge === undefined
        },
        {
            id: 'GOLDEN_2',
            desc: 'Golden Test 2: Customization with pricing',
            msg: "Please prepare a quotation for 1 6-Seater Dining Table with custom size 2100x1000mm and premium teak polish.",
            validate: (res: any) => res.status === 'PENDING_APPROVAL' && res.financials?.subtotal === 32000 && res.financials?.customizationTotal === 12500 && res.financials?.taxableValue === 44500 && res.financials?.totalAmount === 49840
        },
        {
            id: 'GOLDEN_3',
            desc: 'Golden Test 3: Multiple Customization Quantity',
            msg: "I want 2 wardrobes with 2 additional drawers each.",
            validate: (res: any) => res.financials?.customizationTotal === 7200 // 4 drawers * 1800
        },
        {
            id: 'GOLDEN_4',
            desc: 'Golden Test 4: 7% Discount requests approval',
            msg: "Please prepare quotation for Modern 3-Seater Sofa and give me 7% discount on the quotation.",
            validate: (res: any) => res.status === 'PENDING_APPROVAL' && res.approvalDetails.requiredApprover === 'Sales Manager'
        },
        {
            id: 'GOLDEN_5',
            desc: 'Golden Test 5: Ambiguous product',
            msg: "Please prepare a quotation for a 3-seater sofa.",
            validate: (res: any) => res.status === 'AMBIGUOUS'
        },
        {
            id: 'GOLDEN_6',
            desc: 'Golden Test 6: Unknown product',
            msg: "Quote me a 5-door wardrobe.",
            validate: (res: any) => res.status === 'NOT_FOUND'
        },
        {
            id: 'GOLDEN_7',
            desc: 'Golden Test 7: Price override rejected, catalogue used',
            msg: "Quote the Modern 3-Seater Sofa at ₹25,000.",
            validate: (res: any) => res.financials?.subtotal === 38000 // Ignored 25000, used catalogue
        },
        {
            id: 'GOLDEN_8',
            desc: 'Golden Test 8: Quotation Accepted',
            msg: "The quotation looks good. Please proceed.",
            validate: (res: any) => res.status === 'QUOTATION_ACCEPTED'
        },
        {
            id: 'MULTI_ITEM',
            desc: 'Multi-Item Quotation Test',
            msg: "Please quote: 2 Modern 3-Seater Sofas and 1 Dining Chair",
            validate: (res: any) => res.financials?.subtotal === (38000*2 + 5500)
        },
        {
            id: 'DISCOUNT_12',
            desc: '12% discount needs Owner approval',
            msg: "I want a quote for Modern 3-Seater Sofa with 12% discount.",
            validate: (res: any) => res.status === 'PENDING_APPROVAL' && res.approvalDetails.requiredApprover === 'Owner'
        },
        {
            id: 'DISCOUNT_20',
            desc: '20% discount needs Owner Exception',
            msg: "Quote me Modern 3-Seater Sofa with 20% discount.",
            validate: (res: any) => res.status === 'PENDING_APPROVAL' && res.approvalDetails.requiredApprover === 'Owner exception'
        },
        {
            id: 'TEMPLATE_USED',
            desc: 'Verify Quotation Template Usage',
            msg: "Send a quotation for the Modern 3-Seater Sofa.",
            validate: (res: any) => res.templateUsed === 'Aasha_Furniture_Quotation_Template.docx'
        },
        {
            id: 'MISSING_PROD',
            desc: 'Missing product',
            msg: "Please send a quotation.",
            validate: (res: any) => res.status === 'NEEDS_INFORMATION'
        },
        {
            id: 'ACCEPT_AMBIGUOUS',
            desc: 'Accept wrong quotation',
            msg: "I accept it.",
            threadContext: [{}, {}],
            validate: (res: any) => res.status === 'AMBIGUOUS'
        },
        {
            id: 'EXPIRED',
            desc: 'Acceptance of expired quotation',
            msg: "I accept the expired quotation.",
            validate: (res: any) => res.status === 'QUOTATION_EXPIRED'
        },
        {
            id: 'SYNONYM',
            desc: 'Product Synonym Test',
            msg: "I want a quote for a three door wardrobe.",
            validate: (res: any) => res.financials?.subtotal === 28000
        },
        {
            id: 'VALIDATION',
            desc: 'Final Response Validation',
            msg: "Quotation for Modern 3-Seater Sofa.",
            validate: (res: any) => res.validation?.noPlaceholders === true && res.validation?.noInternalIds === true
        },
        {
            id: 'FINAL_RESPONSE_1',
            desc: 'Check final concise email body format',
            msg: "Please send a quotation for 2 Modern 3-Seater Sofas for delivery to Coimbatore.",
            validate: (res: any) => res.message.includes('Dear Karthik') && res.message.toLowerCase().includes('please find attached the quotation for 2 modern 3-seater sofas for delivery to coimbatore') && res.message.includes('Attachment:') && !res.message.includes('Material') && !res.message.includes('Warranty')
        },
        {
            id: 'PDF_GENERATION_MOCK',
            desc: 'Check PDF generation and storage',
            msg: "Quote me 1 Modern 3-Seater Sofa",
            validate: (res: any) => res.pdfGenerated === true && res.pdfAttached === true
        }
    ];

    const { prisma } = require('@agent-flux/database');
    const b = await prisma.business.findFirst({ where: { name: 'Aasha Furniture' } });
    const testBusinessId = b ? b.id : 'aasha-furniture-id';

    let testCustomer = await prisma.customer.findFirst({ where: { businessId: testBusinessId, name: 'Karthik' } });
    if (!testCustomer) {
        testCustomer = await prisma.customer.create({
            data: {
                businessId: testBusinessId,
                name: 'Karthik',
                email: 'karthik@test.com',
                source: 'TEST'
            }
        });
    }

    // Seed a mock template DOCX so generation passes
    const fs = require('fs');
    const path = require('path');
    const templatePath = path.join(process.cwd(), 'uploads', 'test_template.docx');
    
    // Create a dummy template if it doesn't exist
    if (!fs.existsSync(templatePath)) {
        fs.mkdirSync(path.join(process.cwd(), 'uploads'), { recursive: true });
        // Let's copy the empty docx from mammoth test data
        fs.copyFileSync(path.join(process.cwd(), '../../node_modules/.pnpm/mammoth@1.13.0/node_modules/mammoth/test/test-data/empty.docx'), templatePath);
    }

    const existingDoc = await prisma.knowledgeDocument.findFirst({
        where: { businessId: testBusinessId, filename: 'Quotation_Template.docx' }
    });

    if (!existingDoc) {
        let kb = await prisma.knowledgeBase.findFirst({ where: { businessId: testBusinessId } });
        if (!kb) {
            kb = await prisma.knowledgeBase.create({ data: { businessId: testBusinessId, name: 'Default KB' } });
        }
        await prisma.knowledgeDocument.create({
            data: {
                businessId: testBusinessId,
                knowledgeBaseId: kb.id,
                filename: 'Quotation_Template.docx',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                fileSize: 100,
                storagePath: templatePath,
                contentHash: 'mock-hash',
                status: 'INDEXED',
                knowledgeType: 'OTHER'
            }
        });
    }

    for (const test of tests) {
        try {
            const result = await QuotationWorkflowService.processQuotationRequest({
                message: test.msg,
                customerId: testCustomer.id,
                customerName: testCustomer.name || 'Karthik',
                businessId: testBusinessId,
                threadContext: test.threadContext
            });

            if (test.validate(result)) {
                console.log(`✅ [PASS] Test ${test.id}: ${test.desc}`);
                passCount++;
            } else {
                console.log(`❌ [FAIL] Test ${test.id}: ${test.desc}`);
                console.log(`   Output:`, JSON.stringify(result, null, 2));
                failCount++;
            }
        } catch (e: any) {
            console.log(`❌ [ERROR] Test ${test.id}: ${test.desc} - ${e.message}`);
            failCount++;
        }
    }

    console.log(`\n================================================================`);
    console.log(`TOTAL TESTS: ${passCount + failCount} | PASSED: ${passCount} | FAILED: ${failCount}`);
    console.log(`================================================================\n`);
}

runQuotationSuite().catch(console.error);
