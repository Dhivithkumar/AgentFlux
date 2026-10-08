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

  const adapter = new GoogleSheetsAdapter(integration.id);
  
  try {
    const info = await adapter.getSpreadsheetInfo('18z-CMg0of3yHETHo5Yz3SUDFqivdmuPvdE9ZxjPucjw');
    console.log('Success:', info);
  } catch (e: any) {
    console.error('Error fetching info:', e.message);
  }
}

run().catch(console.error);
