import { prisma } from '@agent-flux/database';
import { operationalSyncService } from '../operations/OperationalSyncService';

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
        await this.processJob(job);
      }
    } catch (error) {
      console.error('[OperationalSyncPoller] Error during poll:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async processJob(job: any) {
    console.log(`[OperationalSyncPoller] Processing job ${job.id} for ${job.entityType} ${job.entityId}`);
    
    // Mark processing
    await prisma.operationalSyncJob.update({
      where: { id: job.id },
      data: { status: 'PROCESSING', attemptCount: job.attemptCount + 1 }
    });

    try {
      if (job.entityType === 'ENQUIRY') {
        await operationalSyncService.syncEnquiry(job.businessId, job.entityId);
      } else if (job.entityType === 'CUSTOMER') {
        await operationalSyncService.syncCustomer(job.businessId, job.entityId);
      } else if (job.entityType === 'ORDER') {
        await operationalSyncService.syncOrder(job.businessId, job.entityId);
      } else if (job.entityType === 'INVOICE') {
        await operationalSyncService.syncInvoice(job.businessId, job.entityId);
      } else {
        throw new Error(`Unknown entity type: ${job.entityType}`);
      }

      // Success
      await prisma.operationalSyncJob.update({
        where: { id: job.id },
        data: {
          status: 'SUCCEEDED',
          completedAt: new Date(),
          lastError: null
        }
      });
      console.log(`[OperationalSyncPoller] Job ${job.id} succeeded`);

    } catch (error: any) {
      console.error(`[OperationalSyncPoller] Job ${job.id} failed:`, error.message);
      
      const newAttemptCount = job.attemptCount + 1;
      let nextStatus = 'RETRYING';
      let nextAttemptAt = new Date();

      // Non-retryable errors
      const errorStr = error.message.toLowerCase();
      if (
        errorStr.includes('invalid configuration') || 
        errorStr.includes('not found') || 
        errorStr.includes('permission denied') ||
        errorStr.includes('deleted') ||
        newAttemptCount >= this.maxRetries
      ) {
        nextStatus = 'FAILED';
        nextAttemptAt = null as any;
      } else {
        // Exponential backoff: 10s, 30s, 90s, etc.
        const delaySecs = 10 * Math.pow(3, job.attemptCount);
        nextAttemptAt.setSeconds(nextAttemptAt.getSeconds() + delaySecs);
      }

      await prisma.operationalSyncJob.update({
        where: { id: job.id },
        data: {
          status: nextStatus as any,
          lastError: error.message,
          nextAttemptAt
        }
      });
    }
  }

  async enqueue(businessId: string, entityType: 'ENQUIRY' | 'CUSTOMER' | 'ORDER' | 'INVOICE', entityId: string, operation: string) {
    const job = await prisma.operationalSyncJob.create({
      data: {
        businessId,
        entityType,
        entityId,
        operation
      }
    });
    
    // Attempt immediate processing asynchronously (optional)
    setTimeout(() => {
      if (!this.isRunning) this.poll();
    }, 100);
    
    return job;
  }
}

export const operationalSyncPoller = new OperationalSyncPoller();
