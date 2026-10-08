import { Queue, Worker, Job } from 'bullmq';
import { connection } from './connection';
import { AnalyticsEngine } from '../analytics/engine';

export const ANALYTICS_QUEUE_NAME = 'analytics-aggregation';

export const analyticsQueue = new Queue(ANALYTICS_QUEUE_NAME, { connection });

export const analyticsWorker = new Worker(
  ANALYTICS_QUEUE_NAME,
  async (job: Job) => {
    if (job.name === 'daily-aggregation') {
      console.log(`[AnalyticsQueue] Running daily aggregations for all businesses`);
      await AnalyticsEngine.runAllBusinessAggregations();
    }
  },
  {
    connection,
    concurrency: 1,
  }
);

analyticsWorker.on('failed', (job, err) => {
  console.error(`Analytics Job ${job?.id} failed with error: ${err.message}`);
});

// Schedule the daily aggregation to run every night at midnight (or periodically for testing)
export const scheduleDailyAnalytics = async () => {
  await analyticsQueue.removeJobScheduler('daily-aggregation-scheduler');
  
  await analyticsQueue.upsertJobScheduler(
    'daily-aggregation-scheduler',
    { pattern: '0 0 * * *' }, // every midnight
    {
      name: 'daily-aggregation',
      data: {}
    }
  );
  console.log('[Queue] Scheduled daily analytics aggregation');
};
