import { Queue, Worker } from 'bullmq';
import { connection } from './connection';
import { AgentRuntime } from '../agent/AgentRuntime';

export const agentQueue = new Queue('agentQueue', { connection });

export const agentWorker = new Worker(
  'agentQueue',
  async (job) => {
    if (job.name === 'executeAgent') {
      const { executionId } = job.data;
      await AgentRuntime.resumeExecution(executionId);
    }
  },
  { connection }
);

agentWorker.on('completed', (job) => {
  console.log(`[AgentQueue] Completed execution: ${job.data.executionId}`);
});

agentWorker.on('failed', (job, err) => {
  console.error(`[AgentQueue] Failed execution: ${job?.data.executionId}`, err);
});
