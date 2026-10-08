import { prisma } from '@agent-flux/database';

async function fixWorkflow() {
  const business = await prisma.business.findFirst({
    where: { name: 'Aasha Furniture' }
  });

  if (!business) {
    console.log("Business not found.");
    return;
  }

  const workflows = await prisma.workflow.findMany({
    where: { businessId: business.id, name: '01. Enquiry Intake' },
    include: { versions: true }
  });

  const newDag = {
    nodes: [
      { 
        id: "Trigger", 
        type: "TRIGGER", 
        config: { connector: "GMAIL", action: "email.received" }, 
        next: { DEFAULT: "ProcessInboundEmail" } 
      },
      { 
        id: "ProcessInboundEmail", 
        type: "ACTION", 
        config: { actionId: "PROCESS_INBOUND_EMAIL", inputs: { body: "{{trigger.email.body}}", fromName: "{{trigger.email.from}}", threadId: "{{trigger.email.raw.threadId}}", id: "{{trigger.email.id}}" } }, 
        next: { 
           QUOTATION: "SendQuotationReply", 
           QUOTATION_ACCEPTANCE: "ProcessQuotationAcceptance",
           GENERIC_ENQUIRY: "ExtractInfo" 
        } 
      },
      { 
        id: "SendQuotationReply", 
        type: "ACTION", 
        config: { 
           connector: "GMAIL", 
           action: "gmail.send", 
           subject: "{{steps.ProcessInboundEmail.output.emailSubject}}", 
           body: "{{steps.ProcessInboundEmail.output.emailBody}}", 
           attachments: "{{steps.ProcessInboundEmail.output.attachments}}" 
        }, 
        next: { DEFAULT: "SyncToSheets" } 
      },
      
      // Order Management (Quotation Acceptance)
      {
        id: "ProcessQuotationAcceptance",
        type: "ACTION",
        config: {
          actionId: "PROCESS_QUOTATION_ACCEPTANCE",
          inputs: {
            message: "{{steps.ProcessInboundEmail.output.message}}",
            subject: "{{steps.ProcessInboundEmail.output.subject}}",
            customerId: "{{steps.ProcessInboundEmail.output.customerId}}",
            threadId: "{{steps.ProcessInboundEmail.output.threadId}}"
          }
        },
        next: { SUCCESS: "SendOrderConfirmation", AMBIGUOUS: "SendAmbiguousReply", FAILED: "SendFailureReply" }
      },
      {
        id: "SendOrderConfirmation",
        type: "ACTION",
        config: {
          connector: "GMAIL",
          action: "gmail.send",
          subject: "{{steps.ProcessQuotationAcceptance.output.emailSubject}}",
          body: "{{steps.ProcessQuotationAcceptance.output.emailBody}}"
        },
        next: { DEFAULT: "SyncOrderToSheets" }
      },
      {
        id: "SyncOrderToSheets",
        type: "ACTION",
        config: {
          connector: "GOOGLE_SHEETS",
          action: "sheets.appendRow",
          spreadsheetId: "system-configured-spreadsheet-id", // Assume sheets action resolves this
          range: "Sheet1!A:G",
          values: "{{steps.ProcessQuotationAcceptance.output.sheetsRow}}"
        }
      },
      {
        id: "SendAmbiguousReply",
        type: "ACTION",
        config: { connector: "GMAIL", action: "gmail.send", subject: "Clarification Needed", body: "{{steps.ProcessQuotationAcceptance.output.emailBody}}" }
      },
      {
        id: "SendFailureReply",
        type: "ACTION",
        config: { connector: "GMAIL", action: "gmail.send", subject: "Order Not Confirmed", body: "{{steps.ProcessQuotationAcceptance.output.emailBody}}" }
      },

      // Generic path fallback
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
        next: { DEFAULT: "SyncToSheetsGeneric" } 
      },
      { id: "SyncToSheetsGeneric", type: "ACTION", config: { connector: "GOOGLE_SHEETS", action: "sheets.appendRow" }, next: { DEFAULT: "AutoReply" } },
      { id: "AutoReply", type: "ACTION", config: { connector: "GMAIL", action: "gmail.send", subject: "{{steps.DraftReply.output.emailSubject}}", body: "{{steps.DraftReply.output.emailBody}}" } },
      
      { id: "SyncToSheets", type: "ACTION", config: { connector: "GOOGLE_SHEETS", action: "sheets.appendRow" } }
    ]
  };

  for (const workflow of workflows) {
    console.log(`Fixing workflow ${workflow.id}...`);

    if (workflow.activeVersionId) {
      await prisma.workflowVersion.update({
        where: { id: workflow.activeVersionId },
        data: { definition: newDag }
      });
      console.log(`Updated active version ${workflow.activeVersionId}`);
    }
  }

  // Also update the template just in case
  await prisma.workflowTemplate.updateMany({
    where: { slug: 'furniture-pack-gmail.email.received' },
    data: { workflowDefinition: newDag }
  });

  console.log("Workflow updated successfully.");
}

fixWorkflow().catch(console.error);
