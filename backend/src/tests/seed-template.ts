import { prisma } from '@agent-flux/database';

async function seedTemplate() {
    const business = await prisma.business.findFirst({ where: { name: 'Aasha Furniture' } });
    if (!business) return console.log('Business not found');

    const existing = await prisma.documentTemplate.findFirst({
        where: { businessId: business.id, documentType: 'QUOTATION', status: 'ACTIVE' }
    });

    if (!existing) {
        await prisma.documentTemplate.create({
            data: {
                businessId: business.id,
                documentType: 'QUOTATION',
                name: 'Aasha Furniture Standard Quotation',
                version: 1,
                status: 'ACTIVE'
            }
        });
        console.log('Template created!');
    } else {
        console.log('Template already exists.');
    }
}

seedTemplate().catch(console.error);
