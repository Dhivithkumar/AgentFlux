import { prisma } from '@agent-flux/database';
import { operationalSyncService } from '../operations/OperationalSyncService';
import {
  SetupRequiredError,
  PermissionDeniedError,
  ColumnConflictError,
  OperationalEntityType
} from '../operations/types';

class OperationalSyncPoller {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private maxRetries = 5;

  start(intervalMs: number = 5000) {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.poll(), intervalMs);
    console.log(`[OperationalSyncPoller] Started polling every ${intervalMs}ms`);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async poll() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const pendingJobs = await prisma.operationalSyncJob.findMany({
        where: {
          status: { in: ['PENDING', 'RETRYING'] },
          OR: [
            { nextAttemptAt: null },
            { nextAttemptAt: { lte: new Date() } }
          ]
        },
        orderBy: { createdAt: 'asc' },
        take: 10
      });

      for (const job of pendingJobs) {
        // Atomic claim: only one worker processes this job
        const claim = await prisma.operationalSyncJob.updateMany({
          where: { id: job.id, status: job.status },
          data: {
            status: 'PROCESSING',
            attemptCount: { increment: 1 }
          }
        });

        if (claim.count === 0) {
          // Another worker claimed or cancelled it
          continue;
        }

        await this.processJob(job);
      }
    } catch (error) {
      console.error('[OperationalSyncPoller] Error during poll:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async processJob(job: any) {
    console.log(`[OperationalSyncPoller] Processing job ${job.id} for ${job.entityType} ${job.entityId}`);

    try {
      if (job.operation && job.operation.startsWith('DISPATCH_EVENT:')) {
        const eventType = job.operation.split(':')[1];
        const { EventBus } = require('../../services/eventBus');
        await EventBus.publish(job.businessId, eventType, {
          [job.entityType.toLowerCase() + 'Id']: job.entityId
        });
      }

      // Single authoritative sync path
      await operationalSyncService.syncEntity(
        job.businessId,
        job.entityType as OperationalEntityType,
        job.entityId
      );

      // Job succeeded
      await prisma.operationalSyncJob.update({
        where: { id: job.id },
        data: {
          status: 'SUCCEEDED',
          completedAt: new Date(),
          lastError: null,
          nextAttemptAt: null
        }
      });
      console.log(`[OperationalSyncPoller] Job ${job.id} succeeded`);

      // Reconcile business sheet status
      await operationalSyncService.checkAndUpdateConfigStatus(job.businessId).catch(console.error);

    } catch (error: any) {
      console.error(`[OperationalSyncPoller] Job ${job.id} failed:`, error.message);

      const currentAttempts = job.attemptCount + 1;
      const errorMsg = error.message || '';
      const errorStr = errorMsg.toLowerCase();

      // Check if error is terminal / non-retryable
      const isTerminal =
        error instanceof SetupRequiredError ||
        error instanceof ColumnConflictError ||
        error instanceof PermissionDeniedError ||
        errorStr.includes('setup_required') ||
        errorStr.includes('column conflict') ||
        errorStr.includes('permission denied') ||
        errorStr.includes('reconnection required') ||
        errorStr.includes('not found') ||
        errorStr.includes('deleted') ||
        currentAttempts >= this.maxRetries;

      let nextStatus = 'RETRYING';
      let nextAttemptAt: Date | null = new Date();

      if (isTerminal) {
        nextStatus = 'FAILED';
        nextAttemptAt = null;
      } else {
        // Exponential backoff
        const delaySecs = 10 * Math.pow(2, Math.min(job.attemptCount, 5));
        nextAttemptAt = new Date(Date.now() + delaySecs * 1000);
      }

      await prisma.operationalSyncJob.update({
        where: { id: job.id },
        data: {
          status: nextStatus as any,
          lastError: errorMsg,
          nextAttemptAt,
          completedAt: isTerminal ? new Date() : null
        }
      });

      // Update business config status with error
      await operationalSyncService.checkAndUpdateConfigStatus(job.businessId).catch(console.error);
    }
  }

  async enqueue(
    businessId: string,
    entityType: OperationalEntityType,
    entityId: string,
    operation: string
  ) {
    return operationalSyncService.enqueueSync(businessId, entityType, entityId, operation);
  }
}

export const operationalSyncPoller = new OperationalSyncPoller();
