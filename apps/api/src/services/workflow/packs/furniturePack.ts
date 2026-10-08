import { prisma, IntegrationStatus, RiskLevel } from '@agent-flux/database';
import { randomUUID } from 'crypto';

export async function activateFurniturePack(businessId: string, workflowIndex?: number) {
  // 1. Validate business exists
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      integrations: true,
      documentTemplates: true,
      KnowledgeBase: {
        include: { documents: true }
      }
    }
  });

  if (!business) {
    throw new Error('Business not found');
  }

  const { integrations, documentTemplates, KnowledgeBase } = business;

  // 2-5. Check connections
  const hasGmail = integrations.some(i => i.provider === 'GMAIL' && i.status === IntegrationStatus.CONNECTED);
  const hasSheets = integrations.some(i => i.provider === 'GOOGLE_SHEETS' && i.status === IntegrationStatus.CONNECTED);
  const hasDrive = integrations.some(i => i.provider === 'GOOGLE_DRIVE' && i.status === IntegrationStatus.CONNECTED);

  // We will only throw if they click ACTIVATE ALL (workflowIndex is undefined). 
  // If they activate individually, we allow it.
  if (workflowIndex === undefined) {
    if (!hasGmail) throw new Error('Gmail not connected. Connect Gmail before activation.');
    if (!hasSheets) throw new Error('Google Sheets not connected. Connect Google Sheets before activation.');
    if (!hasDrive) throw new Error('Google Drive not connected. Connect Google Drive before activation.');

    const hasIndexedDocs = KnowledgeBase.some(kb => kb.documents.some(d => d.status === 'INDEXED'));
    if (!hasIndexedDocs) throw new Error('Knowledge Centre not indexed. Upload and index at least one document.');

    const hasQuotationTemplate = documentTemplates.some(t => t.documentType === 'QUOTATION' && t.status === 'ACTIVE');
    const hasInvoiceTemplate = documentTemplates.some(t => t.documentType === 'INVOICE' && t.status === 'ACTIVE');

    if (!hasQuotationTemplate) throw new Error('Quotation template not configured. Create and activate a Quotation template first.');
    if (!hasInvoiceTemplate) throw new Error('Invoice template not configured. Create and activate an Invoice template first.');
  }

  // Check if pack is already active by looking for the 7 workflows
  const existingWorkflows = await prisma.workflow.findMany({
    where: { businessId, category: 'FURNITURE_PACK' }
  });

  if (existingWorkflows.length >= 7) {
    return {
      status: 'ACTIVE',
      businessId,
      pack: 'FURNITURE',
      workflows: existingWorkflows.length,
      message: 'Furniture Automation Pack is already active.',
      connectors: {
        gmail: 'CONNECTED',
        googleSheets: 'CONNECTED',
        googleDrive: 'CONNECTED'
      }
    };
  }

  // Define DAGs
  const enquiryIntakeDag = {
    nodes: [
      { id: "Trigger", type: "TRIGGER", config: { connector: "GMAIL", action: "email.received" }, next: { DEFAULT: "ExtractInfo" } },
      { id: "ExtractInfo", type: "AI_AGENT", config: { task: "Extract customer name and furniture requirements", inputs: { body: "{{trigger.email.body}}" }, outputSchema: { customerName: "string", furnitureRequired: "string" } }, next: { DEFAULT: "SearchKC" } },
      { id: "SearchKC", type: "RAG_SEARCH", config: { query: "{{steps.ExtractInfo.output.furnitureRequired}}", limit: 3 }, next: { DEFAULT: "DraftReply" } },
      { id: "DraftReply", type: "AI_AGENT", config: { 
          task: "Write a personalized email reply to the customer's enquiry. Use ONLY the provided knowledge base results to answer their questions. Be polite and professional.", 
          inputs: { 
             customerName: "{{steps.ExtractInfo.output.customerName}}", 
             customerEnquiry: "{{trigger.email.body}}", 
             knowledgeBaseResults: "{{steps.SearchKC.output.results}}"
          }, 
          outputSchema: { emailSubject: "string", emailBody: "string" }
        }, 
        next: { DEFAULT: "SyncToSheets" } 
      },
      { id: "SyncToSheets", type: "ACTION", config: { connector: "GOOGLE_SHEETS", action: "sheets.appendRow" }, next: { DEFAULT: "AutoReply" } },
      { id: "AutoReply", type: "ACTION", config: { connector: "GMAIL", action: "gmail.send", subject: "{{steps.DraftReply.output.emailSubject}}", body: "{{steps.DraftReply.output.emailBody}}" } }
    ]
  };

  const orderManagementDag = {
    nodes: [
      { id: "Trigger", type: "TRIGGER", config: { connector: "SYSTEM", action: "quotation.accepted" }, next: { DEFAULT: "CreateOrder" } },
      { id: "CreateOrder", type: "ACTION", config: { connector: "DATABASE", action: "db.order.create" }, next: { DEFAULT: "SyncDrive" } },
      { id: "SyncDrive", type: "ACTION", config: { connector: "GOOGLE_DRIVE", action: "drive.createFolder" }, next: { DEFAULT: "NotifyCustomer" } },
      { id: "NotifyCustomer", type: "ACTION", config: { connector: "GMAIL", action: "gmail.send", subject: "Order Confirmed" } }
    ]
  };

  const genericDag = (name: string) => ({
    nodes: [
      { id: "Trigger", type: "TRIGGER", config: { event: "manual" }, next: { DEFAULT: "AgentTask" } },
      { id: "AgentTask", type: "AI_AGENT", config: { task: `Process ${name}` }, next: { DEFAULT: "End" } },
      { id: "End", type: "ACTION", config: { action: "log" } }
    ]
  });

  // Define the workflow templates for the Furniture Pack
  const allWorkflowsToInstall = [
    { name: '01. Enquiry Intake', triggerType: 'gmail.email.received', config: enquiryIntakeDag },
    { name: '02. Order / Booking Management', triggerType: 'quotation.accepted', config: orderManagementDag },
    { name: '03. Quotation & Approval', triggerType: 'enquiry.qualified', config: genericDag('Quotation') },
    { name: '04. Invoice Generation', triggerType: 'order.confirmed', config: genericDag('Invoice') },
    { name: '05. Payment Collection', triggerType: 'payment.received', config: genericDag('Payment') },
    { name: '06. Payment Reminder', triggerType: 'schedule.hourly', config: genericDag('Reminder') },
    { name: '07. Customer Notification', triggerType: 'business.event', config: genericDag('Notification') }
  ];
  const workflowsToInstall = workflowIndex !== undefined 
    ? [allWorkflowsToInstall[workflowIndex]] 
    : allWorkflowsToInstall;

  let workflowsCreated = 0;

  for (const templateData of workflowsToInstall) {
    const existing = existingWorkflows.find(w => w.name === templateData.name);
    if (!existing) {
      // Create Workflow Template if it doesn't exist globally (or we can just skip the template layer and create workflows directly)
      // The instructions say: "Conceptually: Predefined Workflow Template -> Business Activation -> Workflow Instance"
      // Let's create the Workflow Definition on the fly for this business.
      
      let template = await prisma.workflowTemplate.findUnique({
        where: { slug: `furniture-pack-${templateData.triggerType}` }
      });

      if (!template) {
        template = await prisma.workflowTemplate.create({
          data: {
            name: templateData.name,
            slug: `furniture-pack-${templateData.triggerType}`,
            category: 'FURNITURE_PACK',
            description: `Predefined workflow for ${templateData.name}`,
            triggerType: templateData.triggerType,
            requiredIntegrations: ['GMAIL', 'GOOGLE_SHEETS', 'GOOGLE_DRIVE'],
            workflowDefinition: templateData.config,
            status: 'AVAILABLE'
          }
        });
      }

      // Instantiate for the business
      const workflow = await prisma.workflow.create({
        data: {
          businessId,
          templateId: template.id,
          name: templateData.name,
          category: 'FURNITURE_PACK',
          description: `Active instance of ${templateData.name}`,
          status: 'ACTIVE',
          riskLevel: RiskLevel.LOW
        }
      });

      const version = await prisma.workflowVersion.create({
        data: {
          workflowId: workflow.id,
          versionNumber: 1,
          status: 'ACTIVE',
          trigger: { type: templateData.triggerType },
          requiredConnectors: ['GMAIL', 'GOOGLE_SHEETS', 'GOOGLE_DRIVE'],
          definition: templateData.config
        }
      });

      await prisma.workflow.update({
        where: { id: workflow.id },
        data: { activeVersionId: version.id }
      });

      workflowsCreated++;
    }
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      businessId,
      eventType: 'WORKFLOW_PACK_ACTIVATED',
      resourceType: 'WORKFLOW_PACK',
      resourceId: 'FURNITURE_PACK',
      metadata: { workflowsInstalled: workflowsCreated }
    }
  });

  return {
    status: 'ACTIVE',
    businessId,
    pack: 'FURNITURE',
    workflows: existingWorkflows.length + workflowsCreated,
    message: 'Furniture Automation Pack successfully activated.',
    connectors: {
      gmail: 'CONNECTED',
      googleSheets: 'CONNECTED',
      googleDrive: 'CONNECTED'
    }
  };
}
