import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const versions = await prisma.workflowVersion.findMany({
    where: {
      workflow: { name: '01. Enquiry Intake' }
    }
  });

  const newNodes = [
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
  ];

  for (const version of versions) {
    if (version.definition) {
      let definition = version.definition as any;
      definition.nodes = newNodes;
      await prisma.workflowVersion.update({
        where: { id: version.id },
        data: { definition }
      });
      console.log(`Updated workflow version ${version.id}`);
    }
  }

  // Also update templates
  const templates = await prisma.workflowTemplate.findMany({
    where: { name: '01. Enquiry Intake' }
  });

  for (const template of templates) {
    if (template.workflowDefinition) {
      let definition = template.workflowDefinition as any;
      definition.nodes = newNodes;
      await prisma.workflowTemplate.update({
        where: { id: template.id },
        data: { workflowDefinition: definition }
      });
      console.log(`Updated workflow template ${template.id}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
