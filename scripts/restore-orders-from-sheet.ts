import { prisma } from '@agent-flux/database';
import { getGoogleAuth } from '../apps/api/src/services/operations/GoogleSheetsAdapter';
import { google } from 'googleapis';

async function main() {
  const businessId = '1379ce47-39e9-4742-9034-dfe218b6c0fc';
  const config = await prisma.operationalSheetConfig.findFirst({
    where: { businessId }
  });

  if (!config) {
    console.error('No sheet config found for business:', businessId);
    return;
  }

  const auth = await getGoogleAuth(config.integrationId, businessId);
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: 'Orders!A1:Z100'
  });

  const rows = res.data.values;
  if (!rows || rows.length < 2) {
    console.log('No order rows found in Google Sheets.');
    return;
  }

  const headers = rows[0];
  console.log(`Found ${rows.length - 1} order rows in sheet.`);

  let insertedCount = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const orderId = row[0];
    const orderNumber = row[1];
    const customerId = row[2];
    const status = row[6] || 'CONFIRMED';
    const source = row[7] || 'GMAIL';
    const subtotal = row[8] ? parseFloat(row[8]) : null;
    const discount = row[9] ? parseFloat(row[9]) : null;
    const tax = row[10] ? parseFloat(row[10]) : null;
    const totalAmount = row[11] ? parseFloat(row[11]) : null;
    const currency = row[12] || 'INR';
    const createdAt = row[16] ? new Date(row[16]) : new Date();
    const updatedAt = row[17] ? new Date(row[17]) : new Date();

    if (!orderId || !orderNumber || !customerId) {
      console.log(`Skipping invalid row ${i}:`, row);
      continue;
    }

    // Verify customer exists
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      console.log(`Customer ${customerId} not found for order ${orderNumber}, skipping.`);
      continue;
    }

    await prisma.order.upsert({
      where: { id: orderId },
      create: {
        id: orderId,
        businessId,
        customerId,
        orderNumber,
        status,
        source,
        subtotal,
        discount,
        tax,
        totalAmount,
        currency,
        createdAt,
        updatedAt
      },
      update: {
        status,
        totalAmount,
        subtotal,
        discount,
        tax,
        currency,
        updatedAt
      }
    });

    // Also populate for other Aasha Furniture business if desired, or keep it strictly for this authoritative business
    insertedCount++;
    console.log(`Restored order ${orderNumber} (${orderId}) -> ${status}`);
  }

  console.log(`\nSuccessfully restored ${insertedCount} orders to PostgreSQL!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
