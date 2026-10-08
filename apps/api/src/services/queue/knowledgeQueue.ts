import { Queue, Worker, Job } from 'bullmq';
import { knowledgeService } from '../knowledge';
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
const connection = redisUrl ? new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
}) : undefined;

// If Redis URL is missing, we'll still pass empty options or fake connection.
// But we should just pass connection if it exists, otherwise throw or mock.
const queueOptions: any = connection ? { connection } : {};
export const knowledgeQueue = new Queue('knowledge-processing', queueOptions);

if (connection) {
  const worker = new Worker('knowledge-processing', async (job: Job) => {
    console.log(`[Queue] Processing knowledge document: ${job.id}`);
    const { documentId, action } = job.data;
    
    if (action === 'process' || action === 'reprocess') {
      await knowledgeService.processDocument(documentId);
    }
    
  }, { connection });

  worker.on('completed', job => {
    console.log(`[Queue] Completed knowledge document: ${job.id}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Queue] Failed knowledge document: ${job?.id}`, err);
  });
} else {
  console.warn('REDIS_URL not set, knowledgeQueue will not run background jobs!');
}
