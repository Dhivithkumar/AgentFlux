import { prisma } from '@agent-flux/database';
import { GoogleSheetsAdapter } from '../apps/api/src/services/operations/GoogleSheetsAdapter';

async function run() {
  const integration = await prisma.integration.findFirst({
    where: { provider: 'GOOGLE_SHEETS', status: 'CONNECTED' }
  });

  if (!integration) {
    console.log('No connected GOOGLE_SHEETS integration found');
    return;
  }

  console.log('Found integration:', integration.id);
  const adapter = new GoogleSheetsAdapter(integration.id);
  
  try {
    const sheets = await adapter.listSpreadsheets();
    console.log('Success:', sheets.length);
  } catch (e: any) {
    console.error('Error listing spreadsheets:', e.message);
    console.error(e.stack);
  }
}

run().catch(console.error);
