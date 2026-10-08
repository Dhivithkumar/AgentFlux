import { Queue, Worker, Job } from 'bullmq';
import { connection } from './connection';
import { WorkflowEngine } from '../workflow/engine';

export const WORKFLOW_QUEUE_NAME = 'workflow-execution';

// The Queue instance to add jobs
export const workflowQueue = new Queue(WORKFLOW_QUEUE_NAME, { connection });

// The Worker instance to process jobs
export const workflowWorker = new Worker(
  WORKFLOW_QUEUE_NAME,
  async (job: Job) => {
    if (job.data.isScheduled) {
      const { workflowId, businessId } = job.data;
      console.log(`[Queue] Triggering scheduled workflow: ${workflowId}`);
      await WorkflowEngine.triggerWorkflow(businessId, workflowId, 'SCHEDULE', { scheduledAt: new Date().toISOString() });
    } else {
      const { executionId } = job.data;
      console.log(`[Queue] Processing execution: ${executionId}`);
      try {
        await WorkflowEngine.executeWorkflow(executionId);
        console.log(`[Queue] Completed execution: ${executionId}`);
      } catch (err) {
        console.error(`[Queue] Failed execution: ${executionId}`, err);
        throw err; // Let BullMQ handle retries
      }
    }
  },
  {
    connection,
    concurrency: 5, // Process up to 5 workflows concurrently
  }
);

workflowWorker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed with error: ${err.message}`);
});

export const scheduleWorkflow = async (workflowId: string, businessId: string, cron: string) => {
  // Use a predictable jobId to allow updates/removals if needed
  const jobId = `cron-${workflowId}`;
  
  // Remove existing if any
  await workflowQueue.removeJobScheduler(jobId);
  
  console.log(`[Queue] Scheduling workflow ${workflowId} with cron: ${cron}`);
  await workflowQueue.upsertJobScheduler(
    jobId,
    { pattern: cron },
    {
      name: 'executeWorkflow',
      data: { workflowId, businessId, isScheduled: true }
    }
  );
};
