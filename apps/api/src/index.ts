import './env';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

import authRoutes from './routes/auth';
import businessRoutes from './routes/businesses';
import integrationRoutes from './routes/integrations';
import workflowRoutes from './routes/workflows';
import workflowTemplateRoutes from './routes/workflow-templates';
import workflowPacksRoutes from './routes/workflow-packs';
import knowledgeRoutes from './routes/knowledge';
import executionRoutes from './routes/executions';
import approvalRoutes from './routes/approvals';
import enquiryRoutes from './routes/enquiry';
import settingsRoutes from './routes/settings';
import './services/queue/workflowQueue'; // Initialize BullMQ worker
import './services/queue/knowledgeQueue'; // Initialize Knowledge worker
import './services/queue/agentQueue'; // Initialize Agent worker
import './services/agent/agentTools'; // Register Agent tools
import './services/queue/analyticsQueue'; // Initialize Analytics worker
import { scheduleDailyAnalytics } from './services/queue/analyticsQueue';
import { emailPoller } from './services/queue/emailPoller';

import { operationalSyncPoller } from './services/queue/operationalSyncPoller';

const app = express();
emailPoller.start(10000); // Poll every 10 seconds for testing
operationalSyncPoller.start(5000); // Poll every 5s for operational sync jobs
scheduleDailyAnalytics(); // Schedule daily aggregations
const port = process.env.NODE_ENV === 'production' ? (process.env.PORT || 3001) : 3001;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/workflow-templates', workflowTemplateRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/executions', executionRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/settings', settingsRoutes);
import { operationsRouter } from './routes/operations';
import ordersRouter from './routes/orders';
import quotationsRouter from './routes/quotations';
import invoicesRouter from './routes/invoices';
import templatesRouter from './routes/templates';
import { paymentsRouter } from './routes/payments';
import { paymentWebhooksRouter } from './routes/payment-webhooks';
import governanceRoutes from './routes/governance';
import genericApprovalsRoutes from './routes/genericApprovals';
import agentsRoutes from './routes/agents';
import analyticsRoutes from './routes/analytics';
import aiRoutes from './routes/ai';

app.use('/api/enquiries', enquiryRoutes);
app.use('/api/operations', operationsRouter);
app.use('/api/businesses/:businessId/orders', ordersRouter);
app.use('/api/ai', aiRoutes);
app.use('/api/businesses/:businessId/quotations', quotationsRouter);
app.use('/api/businesses/:businessId/invoices', invoicesRouter);
app.use('/api/businesses/:businessId/templates', templatesRouter);
app.use('/api/businesses/:businessId/governance', governanceRoutes);
app.use('/api/businesses/:businessId/approvals', genericApprovalsRoutes);
app.use('/api/businesses/:businessId/agents', agentsRoutes);
app.use('/api/businesses/:businessId/analytics', analyticsRoutes);
app.use('/api/businesses/:businessId/workflow-packs', workflowPacksRoutes);
app.use('/api/businesses/:businessId', paymentsRouter); // mounts /invoices/:invoiceId/payments and /payments/:paymentId/confirm
app.use('/api/webhooks/payments', paymentWebhooksRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port as number, '0.0.0.0', () => {
  console.log(`API running on port ${port} (restarted)`);
});

