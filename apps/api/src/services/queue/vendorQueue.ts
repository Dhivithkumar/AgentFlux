import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { vendorVerificationService } from '../vendor/VendorVerificationService';

const redisUrl = process.env.REDIS_URL;
let connection: Redis | undefined;

try {
  if (redisUrl) {
    connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      connectTimeout: 5000,
      lazyConnect: true
    });
    connection.connect().catch((err) => {
      console.warn('[VendorQueue] Redis connection failed, fallback to direct execution:', err.message);
    });
  }
} catch (e: any) {
  console.warn('[VendorQueue] Redis initialization skipped:', e.message);
}

const queueOptions: any = connection ? { connection } : {};
export const vendorVerificationQueue = new Queue('vendor-verification', queueOptions);

if (connection) {
  const worker = new Worker(
    'vendor-verification',
    async (job: Job) => {
      console.log(`[VendorQueue] Processing verification job ${job.id} for vendor ${job.data.vendorId}`);
      const { businessId, vendorId, userId } = job.data;
      return await vendorVerificationService.verifyVendor(businessId, vendorId, userId);
    },
    {
      connection,
      concurrency: 5
    }
  );

  worker.on('completed', (job) => {
    console.log(`[VendorQueue] Verification job ${job.id} completed for vendor ${job.data.vendorId}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[VendorQueue] Verification job ${job?.id} failed:`, err);
  });
}

/**
 * Enqueues a vendor verification task or executes asynchronously with fallback.
 */
export async function enqueueVendorVerification(
  businessId: string,
  vendorId: string,
  userId?: string
): Promise<{ jobId?: string; queued: boolean }> {
  try {
    if (connection && connection.status === 'ready') {
      const job = await vendorVerificationQueue.add(
        'verify',
        { businessId, vendorId, userId },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          },
          removeOnComplete: true
        }
      );
      return { jobId: job.id, queued: true };
    }
  } catch (err: any) {
    console.warn('[VendorQueue] Failed to enqueue to Redis, running asynchronous background task:', err.message);
  }

  // Graceful asynchronous execution fallback if Redis is unreachable
  setImmediate(async () => {
    try {
      await vendorVerificationService.verifyVendor(businessId, vendorId, userId);
    } catch (err: any) {
      console.error('[VendorQueue] Direct verification execution error:', err);
    }
  });

  return { queued: false };
}
