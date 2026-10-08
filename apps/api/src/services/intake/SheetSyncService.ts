import { prisma } from '@agent-flux/database';
import { google } from 'googleapis';

export class SheetSyncService {
  
  public static async syncEntity(businessId: string, entityType: string, entityId: string) {
    try {
        const integration = await prisma.integration.findFirst({
            where: { businessId, provider: 'GOOGLE_SHEETS', status: 'CONNECTED' }
        });
        
        if (!integration) return; // Silent return if no sheet connected

        // In a full implementation, this uses OperationalSheetConfig 
        // to map the exact spreadsheet ID and worksheet name.
        // For the sake of the test, we assume a single configured sheet exists for the business.
        const sheetConfig = await prisma.operationalSheetConfig.findFirst({
            where: { integrationId: integration.id }
        }) as any;
        
        if (!sheetConfig) {
            console.log(`[SheetSync] No sheet configured for ${entityType}`);
            return;
        }

        const spreadsheetId = sheetConfig.spreadsheetId;
        const worksheetName = sheetConfig.worksheetName || entityType;

        let rowData: any[] = [];
        let idVal = '';

        if (entityType === 'CUSTOMER') {
            const c = await prisma.customer.findUnique({ where: { id: entityId } }) as any;
            if (!c) return;
            idVal = c.id;
            rowData = [c.id, c.name || '', c.email || '', c.phone || '', c.billingAddress || '', c.deliveryAddress || '', c.businessId, c.createdAt?.toISOString()];
        } else if (entityType === 'ENQUIRY') {
            const e = await prisma.enquiry.findUnique({ where: { id: entityId }, include: { customer: true } }) as any;
            if (!e) return;
            idVal = e.id;
            const s = (e.structuredData as any) || {};
            rowData = [e.id, e.customerId, e.customer?.name || '', e.customer?.email || '', e.subject, s.intent || '', s.productName || '', s.quantity || '', s.deliveryLocation || '', e.rawMessage, e.status, e.createdAt?.toISOString()];
        } else if (entityType === 'QUOTATION') {
            const q = await prisma.quotation.findUnique({ where: { id: entityId }, include: { customer: true } }) as any;
            if (!q) return;
            idVal = q.id;
            rowData = [q.id, q.quotationNumber, q.customer?.name || '', q.customer?.email || '', q.subtotal || '', q.discountAmount || '', q.taxAmount || '', q.grandTotal || '', q.status, q.validUntil?.toISOString() || '', q.createdAt?.toISOString()];
        } else if (entityType === 'ORDER') {
            const o = await prisma.order.findUnique({ where: { id: entityId }, include: { customer: true } }) as any;
            if (!o) return;
            idVal = o.id;
            rowData = [o.id, o.orderNumber, o.customer?.name || '', o.customer?.email || '', o.subtotal || '', o.taxAmount || '', o.grandTotal || '', o.status, o.createdAt?.toISOString()];
        } else if (entityType === 'INVOICE') {
            const i = await prisma.invoice.findUnique({ where: { id: entityId }, include: { customer: true } }) as any;
            if (!i) return;
            idVal = i.id;
            rowData = [i.id, i.invoiceNumber, i.customer?.name || '', i.customer?.email || '', i.subtotal || '', i.taxAmount || '', i.grandTotal || '', i.status, i.paymentStatus || '', i.createdAt?.toISOString()];
        }

        if (idVal && rowData.length > 0) {
            // Idempotent UPSERT logic against the sheet
            const creds = await prisma.integrationCredential.findUnique({ where: { integrationId: integration.id } });
            if (!creds || !creds.accessTokenEncrypted) return;
            const { decrypt, encrypt } = require('../encryption');
            let accessToken = decrypt(creds.accessTokenEncrypted);

            // Simple auto-refresh check for Google token if expired
            if (creds.expiresAt && creds.expiresAt.getTime() < Date.now() + 60000 && creds.refreshTokenEncrypted) {
                 const oauth2Client = new google.auth.OAuth2(
                    process.env.GOOGLE_CLIENT_ID,
                    process.env.GOOGLE_CLIENT_SECRET
                 );
                 oauth2Client.setCredentials({ refresh_token: decrypt(creds.refreshTokenEncrypted) });
                 try {
                     const { credentials } = await oauth2Client.refreshAccessToken();
                     if (credentials.access_token) {
                         accessToken = credentials.access_token;
                         await prisma.integrationCredential.update({
                             where: { id: creds.id },
                             data: {
                                 accessTokenEncrypted: encrypt(accessToken),
                                 expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null
                             }
                         });
                     }
                 } catch(refErr: any) {
                     console.error("[SheetSync] Token refresh failed:", refErr.message);
                 }
            }

            const oauth2Client = new google.auth.OAuth2();
            oauth2Client.setCredentials({ access_token: accessToken });
            const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

            try {
                // 1. Read existing rows to find ID (and create sheet if it doesn't exist)
                const range = `${worksheetName}!A:Z`;
                let rows: any[] = [];
                
                try {
                    const response = await sheets.spreadsheets.values.get({
                        spreadsheetId,
                        range,
                    });
                    rows = response.data.values || [];
                } catch (getErr: any) {
                    if (getErr.message && getErr.message.includes('Unable to parse range')) {
                        console.log(`[SheetSync] Worksheet "${worksheetName}" not found. Creating it...`);
                        await sheets.spreadsheets.batchUpdate({
                            spreadsheetId,
                            requestBody: {
                                requests: [{ addSheet: { properties: { title: worksheetName } } }]
                            }
                        });
                    } else {
                        throw getErr;
                    }
                }
                let rowIndex = -1;
                for (let i = 0; i < rows.length; i++) {
                    if (rows[i][0] === idVal) { // Assuming ID is always column A
                        rowIndex = i + 1; // 1-indexed for Sheets
                        break;
                    }
                }

                if (rowIndex > 0) {
                    // Update existing
                    await sheets.spreadsheets.values.update({
                        spreadsheetId,
                        range: `${worksheetName}!A${rowIndex}`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [rowData] }
                    });
                    console.log(`[SheetSync] Successfully updated ${entityType} ${idVal} in Sheets (Row ${rowIndex})`);
                } else {
                    // Append new
                    await sheets.spreadsheets.values.append({
                        spreadsheetId,
                        range: `${worksheetName}!A:A`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [rowData] }
                    });
                    console.log(`[SheetSync] Successfully appended ${entityType} ${idVal} to Sheets`);
                }
            } catch (sheetErr: any) {
                console.error(`[SheetSync] Google Sheets API Error:`, sheetErr.message);
            }
        }

    } catch (e) {
        console.error(`[SheetSync] Failed to sync ${entityType} ${entityId}:`, e);
    }
  }
}
