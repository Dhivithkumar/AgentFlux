const fs = require('fs');
const PizZip = require('pizzip');
const { createReport } = require('docx-templates');

async function test() {
    const content = fs.readFileSync('uploads/1379ce47-39e9-4742-9034-dfe218b6c0fc/knowledge/e9214f1f-3377-42d6-b0ff-8516b6be6dcc/2ad00349-f428-4fb0-83a5-c6dfec05db93/original.docx');
    const zip = new PizZip(content);
    let xml = zip.file('word/document.xml').asText();

    const line_items = [
        { item_index: 1, item_sku: 'S1', item_description: 'D1', item_quantity: 1, item_unit_price: 1, item_discount: 1, item_taxable_value: 1, item_line_total: 1 },
        { item_index: 2, item_sku: 'S2', item_description: 'D2', item_quantity: 2, item_unit_price: 2, item_discount: 2, item_taxable_value: 2, item_line_total: 2 }
    ];

    if (xml.includes('{{item_sku}}')) {
        const skuIdx = xml.indexOf('{{item_sku}}');
        const rowStart = xml.lastIndexOf('<w:tr ', skuIdx);
        const rowStartAlt = xml.lastIndexOf('<w:tr>', skuIdx);
        const actualRowStart = Math.max(rowStart, rowStartAlt);
        const rowEnd = xml.indexOf('</w:tr>', skuIdx) + 7;

        if (actualRowStart !== -1 && rowEnd !== -1) {
            const rowXml = xml.substring(actualRowStart, rowEnd);
            let newRows = '';
            for (const item of line_items) {
                let r = rowXml;
                for (const key of Object.keys(item)) {
                    r = r.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), item[key]);
                }
                newRows += r;
            }
            xml = xml.substring(0, actualRowStart) + newRows + xml.substring(rowEnd);
        }
    }
    
    xml = xml.replace(/Repeat the marked line-item row for every element in \{\{line_items\}\}./g, '');
    zip.file('word/document.xml', xml);
    const preprocessedBuffer = zip.generate({ type: 'nodebuffer' });

    const buffer = await createReport({
        template: preprocessedBuffer,
        data: {
            business_name: 'Aasha Furniture',
            business_address: 'Address',
            business_phone: '1234',
            business_email: 'test@test.com',
            business_gstin: 'GSTIN',
            quotation_number: 'Q-001',
            quotation_date: 'Date',
            valid_until: 'Date',
            customer_name: 'Customer',
            customer_email: 'Email',
            customer_phone: 'Phone',
            billing_address: 'Address',
            customer_gstin: 'GSTIN',
            enquiry_id: '1',
            customer_reference: 'ref',
            order_id: '1',
            delivery_location: 'Loc',
            subtotal: '100',
            discount_total: '10',
            taxable_amount: '90',
            gst_amount: '9',
            grand_total: '99',
            payment_terms: 'PT',
            delivery_terms: 'DT',
            document_notes: 'Notes',
            businessId: '', documentId: '', customerId: '', quotationId: '', workflowId: '', chunkId: '', embeddingId: '',
            business_id: '', document_id: '', customer_id: '', quotation_id: '', workflow_id: '', chunk_id: '', embedding_id: ''
        },
        cmdDelimiter: ['{{', '}}'],
        failFast: false
    });
    fs.writeFileSync('scratch/test_out.docx', buffer);
    console.log('Success');
}
test().catch(console.error);
