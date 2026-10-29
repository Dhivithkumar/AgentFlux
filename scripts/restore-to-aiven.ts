import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

/**
 * RESTORE DATA FROM VERIFIED SUPABASE BACKUP TO AIVEN POSTGRESQL
 * Preserves all primary keys, foreign keys, timestamps, and relations.
 */

const aivenUrl = process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL;

if (!aivenUrl) {
  console.error('ERROR: No database URL provided. Set AIVEN_DATABASE_URL or DATABASE_URL.');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: aivenUrl }
  }
});

async function main() {
  console.log('===============================================================');
  console.log('AGENT FLUX: RESTORING DATA FROM SUPABASE BACKUP TO AIVEN');
  console.log('Target Database:', aivenUrl.split('@')[1] || 'Aiven PostgreSQL');
  console.log('===============================================================\n');

  const backupFilePath = path.join(__dirname, '..', 'scratch', 'supabase-backup', 'backup-1793030577274.json');
  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file not found at: ${backupFilePath}`);
  }

  const backupData = JSON.parse(fs.readFileSync(backupFilePath, 'utf-8'));

  // Define insertion order respecting foreign key dependencies:
  const modelOrder = [
    'user',
    'business',
    'membership',
    'businessConfiguration',
    'oAuthState',
    'integration',
    'knowledgeBase',
    'knowledgeDocument',
    'knowledgeChunk',
    'customer',
    'workflow',
    'workflowVersion',
    'workflowStep',
    'enquiry',
    'quotation',
    'documentTemplate'
  ];

  const summary: Record<string, { read: number; inserted: number; errors: number }> = {};

  for (const model of modelOrder) {
    const records = backupData[model] || [];
    summary[model] = { read: records.length, inserted: 0, errors: 0 };

    if (records.length === 0) continue;

    console.log(`Restoring ${records.length} records into model [${model}]...`);

    const delegate = (prisma as any)[model];
    if (!delegate) {
      console.warn(`  [!] Warning: Model delegate ${model} not found on Prisma Client.`);
      continue;
    }

    for (const record of records) {
      try {
        // Use upsert where unique identifier exists, otherwise create
        if (record.id) {
          await delegate.upsert({
            where: { id: record.id },
            update: record,
            create: record
          });
        } else {
          await delegate.create({ data: record });
        }
        summary[model].inserted++;
      } catch (err: any) {
        summary[model].errors++;
        console.error(`  [x] Error inserting into ${model} (id: ${record.id}):`, err.message);
      }
    }

    console.log(`  ✓ Inserted ${summary[model].inserted}/${summary[model].read} records into [${model}].`);
  }

  console.log('\n===============================================================');
  console.log('DATA RESTORATION SUMMARY:');
  console.log('===============================================================');
  console.table(summary);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('\nFATAL ERROR during data restoration:', e);
  await prisma.$disconnect();
  process.exit(1);
});

