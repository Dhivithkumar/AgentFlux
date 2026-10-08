import { prisma } from '@agent-flux/database';

export class AnalyticsEngine {
  
  static async generateDailySnapshot(businessId: string) {
    console.log(`[AnalyticsEngine] Generating daily snapshot for ${businessId}`);
    
    // Define the period (yesterday)
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

    // Collect metrics
    const enquiries = await prisma.enquiry.count({
      where: { businessId, createdAt: { gte: start, lt: end } }
    });

    const orders = await prisma.order.count({
      where: { businessId, createdAt: { gte: start, lt: end } }
    });

    const payments = await prisma.payment.aggregate({
      where: { businessId, status: 'SUCCEEDED', createdAt: { gte: start, lt: end } },
      _sum: { amount: true }
    });

    const workflowExecutions = await prisma.workflowExecution.count({
      where: { businessId, startedAt: { gte: start, lt: end } }
    });

    const data = {
      enquiries,
      orders,
      revenue: payments._sum.amount || 0,
      workflowExecutions
    };

    await prisma.analyticsSnapshot.create({
      data: {
        businessId,
        snapshotType: 'DAILY_BUSINESS',
        periodStart: start,
        periodEnd: end,
        data
      }
    });
  }

  static async generateInsights(businessId: string) {
    console.log(`[AnalyticsEngine] Generating insights for ${businessId}`);
    
    // Deterministic insight: check high error rate in workflows
    const totalExecutions = await prisma.workflowExecution.count({ where: { businessId } });
    const failedExecutions = await prisma.workflowExecution.count({ where: { businessId, status: 'FAILED' } });
    
    if (totalExecutions > 20 && (failedExecutions / totalExecutions) > 0.1) {
      // Check if recommendation already exists to avoid duplicates
      const exists = await prisma.improvementRecommendation.findFirst({
        where: { businessId, category: 'WORKFLOW_FAILURE', status: 'NEW' }
      });
      
      if (!exists) {
        await prisma.improvementRecommendation.create({
          data: {
            businessId,
            sourceType: 'WORKFLOW',
            category: 'WORKFLOW_FAILURE',
            title: 'High Workflow Failure Rate',
            description: `Your workflows are failing at a rate of ${((failedExecutions / totalExecutions) * 100).toFixed(1)}%.`,
            evidence: {
              totalExecutions,
              failedExecutions
            },
            status: 'NEW'
          }
        });
      }
    }
    
    // Check Agent Cost Insight
    const agentExecutions = await prisma.agentExecution.findMany({
      where: { businessId },
      select: { tokenUsage: true }
    });
    let totalTokens = 0;
    agentExecutions.forEach(e => {
       if (e.tokenUsage && typeof e.tokenUsage === 'object') {
           const usage = e.tokenUsage as { totalTokens?: number };
           totalTokens += (usage.totalTokens || 0);
       }
    });
    
    if (totalTokens > 500000) {
      const exists = await prisma.improvementRecommendation.findFirst({
        where: { businessId, category: 'AI_COST', status: 'NEW' }
      });
      
      if (!exists) {
        await prisma.improvementRecommendation.create({
          data: {
            businessId,
            sourceType: 'AGENT',
            category: 'AI_COST',
            title: 'High AI Token Usage',
            description: `Agents have consumed over 500,000 tokens. Consider optimizing prompts or replacing deterministic logic.`,
            evidence: {
              totalTokens
            },
            status: 'NEW'
          }
        });
      }
    }
  }

  static async runAllBusinessAggregations() {
    const businesses = await prisma.business.findMany({ select: { id: true } });
    for (const b of businesses) {
      await this.generateDailySnapshot(b.id);
      await this.generateInsights(b.id);
    }
  }
}
