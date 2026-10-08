import { prisma } from '@agent-flux/database';



const templates = [
  // CUSTOMER SUPPORT
  {
    slug: 'order-status-support',
    name: 'Order Status Query',
    category: 'CUSTOMER SUPPORT',
    description: 'Automatically reply to customer emails asking for order status by checking Shopify and emailing back.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL', 'SHOPIFY'],
    requiredCapabilities: ['EMAIL.READ', 'EMAIL.SEND', 'ECOMMERCE.READ_ORDER'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [
      { id: 'extract_order', type: 'AI_TASK', config: { task: 'Extract Order', prompt: 'Extract order number from {{trigger.email.body}}', schema: { type: 'object', properties: { order_number: { type: 'string' } } } } },
      { id: 'check_shopify', type: 'TOOL_ACTION', config: { capability: 'ECOMMERCE.READ_ORDER', actionId: 'get_order', inputs: { orderId: '{{steps.extract_order.output.order_number}}' } } },
      { id: 'send_reply', type: 'TOOL_ACTION', config: { capability: 'EMAIL.SEND', actionId: 'send_email', inputs: { to: '{{trigger.email.from}}', subject: 'Re: {{trigger.email.subject}}', body: 'Your order status is: {{steps.check_shopify.output.status}}' } } }
    ],
    riskLevel: 'LOW'
  },
  {
    slug: 'refund-request',
    name: 'Refund Request',
    category: 'CUSTOMER SUPPORT',
    description: 'Process refund requests, checking eligibility and requesting human approval.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL', 'STRIPE'],
    requiredCapabilities: ['EMAIL.READ', 'PAYMENT.READ_CHARGE', 'PAYMENT.REFUND'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [
      { id: 'extract_info', type: 'AI_TASK', config: { task: 'Extract Payment Info', prompt: 'Extract charge ID from {{trigger.email.body}}', schema: { type: 'object', properties: { charge_id: { type: 'string' } } } } },
      { id: 'check_stripe', type: 'TOOL_ACTION', config: { capability: 'PAYMENT.READ_CHARGE', actionId: 'get_charge', inputs: { chargeId: '{{steps.extract_info.output.charge_id}}' } }, next: ['approval'] },
      { id: 'approval', type: 'APPROVAL', config: { approver: 'manager' }, next: ['process_refund'] },
      { id: 'process_refund', type: 'TOOL_ACTION', config: { capability: 'PAYMENT.REFUND', actionId: 'refund', inputs: { chargeId: '{{steps.extract_info.output.charge_id}}' } } }
    ],
    riskLevel: 'MEDIUM'
  },
  {
    slug: 'return-request',
    name: 'Return Request',
    category: 'CUSTOMER SUPPORT',
    description: 'Handle customer return requests, generate shipping labels, and notify customer.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL', 'SHOPIFY'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },
  {
    slug: 'product-question',
    name: 'Product Question',
    category: 'CUSTOMER SUPPORT',
    description: 'Use AI to answer product questions from your knowledge base.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },
  {
    slug: 'customer-complaint',
    name: 'Customer Complaint',
    category: 'CUSTOMER SUPPORT',
    description: 'Detect angry emails, create a high-priority ticket, and alert the team on Slack.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL', 'SLACK'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'HIGH'
  },
  {
    slug: 'support-ticket-classification',
    name: 'Support Ticket Classification',
    category: 'CUSTOMER SUPPORT',
    description: 'Classify incoming emails and route them to the right department.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },
  
  // SALES
  {
    slug: 'new-lead-qualification',
    name: 'New Lead Qualification',
    category: 'SALES',
    description: 'Qualify inbound leads and sync them to CRM.',
    icon: null,
    triggerType: 'FORM_SUBMISSION',
    requiredIntegrations: ['GMAIL', 'HUBSPOT'],
    requiredCapabilities: ['EMAIL.READ', 'EMAIL.SEND', 'CRM.CREATE_LEAD', 'CRM.SEARCH_CONTACT'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },
  {
    slug: 'lead-follow-up',
    name: 'Lead Follow-up',
    category: 'SALES',
    description: 'Automatically follow up with customers who showed interest but haven\'t replied.',
    icon: null,
    triggerType: 'TIME_DELAY',
    requiredIntegrations: ['GMAIL', 'CRM'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'MEDIUM'
  },
  {
    slug: 'quote-generation',
    name: 'Quote Generation',
    category: 'SALES',
    description: 'Generate PDF quotes based on customer email requests.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL', 'GOOGLE_DRIVE'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'MEDIUM'
  },
  {
    slug: 'crm-update',
    name: 'CRM Update',
    category: 'SALES',
    description: 'Extract details from emails and update CRM records automatically.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL', 'HUBSPOT'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },
  {
    slug: 'enquiry-capture',
    name: 'Enquiry -> Lead',
    category: 'SALES',
    description: 'Capture general enquiries and convert them into sales leads.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL', 'CRM'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },

  // OPERATIONS
  {
    slug: 'inventory-alert',
    name: 'Inventory Alert',
    category: 'OPERATIONS',
    description: 'Notify the team when inventory levels fall below threshold.',
    icon: null,
    triggerType: 'SCHEDULE',
    requiredIntegrations: ['SHOPIFY', 'SLACK'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },
  {
    slug: 'supplier-follow-up',
    name: 'Supplier Follow-up',
    category: 'OPERATIONS',
    description: 'Follow up with suppliers for pending deliveries.',
    icon: null,
    triggerType: 'SCHEDULE',
    requiredIntegrations: ['GMAIL'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },
  {
    slug: 'purchase-order-processing',
    name: 'Purchase Order Processing',
    category: 'OPERATIONS',
    description: 'Process incoming purchase orders and update ERP.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL', 'GOOGLE_SHEETS'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'MEDIUM'
  },
  {
    slug: 'order-processing',
    name: 'Order Processing',
    category: 'OPERATIONS',
    description: 'Automate order verification and dispatch preparation.',
    icon: null,
    triggerType: 'WEBHOOK',
    requiredIntegrations: ['SHOPIFY'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'MEDIUM'
  },
  {
    slug: 'dispatch-delivery',
    name: 'Dispatch Notification',
    category: 'OPERATIONS',
    description: 'Send SMS/Email to customers when an order is dispatched.',
    icon: null,
    triggerType: 'WEBHOOK',
    requiredIntegrations: ['GMAIL', 'TWILIO'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },

  // FINANCE
  {
    slug: 'invoice-extraction',
    name: 'Invoice Extraction',
    category: 'FINANCE',
    description: 'Extract data from supplier invoices and log into Google Sheets.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL', 'GOOGLE_SHEETS'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },
  {
    slug: 'payment-reminder',
    name: 'Payment Reminder',
    category: 'FINANCE',
    description: 'Send reminders for overdue invoices.',
    icon: null,
    triggerType: 'SCHEDULE',
    requiredIntegrations: ['GMAIL', 'STRIPE'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'MEDIUM'
  },
  {
    slug: 'payment-collection',
    name: 'Payment Collection',
    category: 'FINANCE',
    description: 'Process recurring payments automatically.',
    icon: null,
    triggerType: 'SCHEDULE',
    requiredIntegrations: ['STRIPE'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'HIGH'
  },
  {
    slug: 'expense-categorization',
    name: 'Expense Categorization',
    category: 'FINANCE',
    description: 'Use AI to categorize expenses based on receipts.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL', 'GOOGLE_SHEETS'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },
  {
    slug: 'receipt-processing',
    name: 'Receipt Processing',
    category: 'FINANCE',
    description: 'Save incoming receipts to a designated Google Drive folder.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL', 'GOOGLE_DRIVE'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },

  // MANAGEMENT
  {
    slug: 'daily-business-report',
    name: 'Daily Business Report',
    category: 'MANAGEMENT',
    description: 'Compile daily sales and support metrics and email the manager.',
    icon: null,
    triggerType: 'SCHEDULE',
    requiredIntegrations: ['GMAIL', 'SHOPIFY'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },
  {
    slug: 'weekly-performance-report',
    name: 'Weekly Performance Report',
    category: 'MANAGEMENT',
    description: 'Generate weekly KPI reports.',
    icon: null,
    triggerType: 'SCHEDULE',
    requiredIntegrations: ['GMAIL', 'GOOGLE_SHEETS'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },
  {
    slug: 'meeting-summary',
    name: 'Meeting Summary',
    category: 'MANAGEMENT',
    description: 'Summarize meeting transcripts and email action items.',
    icon: null,
    triggerType: 'WEBHOOK',
    requiredIntegrations: ['GMAIL'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },

  // COMMUNICATION
  {
    slug: 'important-email-task',
    name: 'Important Email -> Task',
    category: 'COMMUNICATION',
    description: 'Identify important emails and create tasks in your project management tool.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL', 'TRELLO'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },
  {
    slug: 'email-calendar-event',
    name: 'Email -> Calendar Event',
    category: 'COMMUNICATION',
    description: 'Extract dates from emails and automatically schedule calendar events.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL', 'GOOGLE_CALENDAR'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },
  {
    slug: 'appointment-booking',
    name: 'Appointment Booking',
    category: 'COMMUNICATION',
    description: 'Automatically check availability and book appointments via email.',
    icon: null,
    triggerType: 'EMAIL_RECEIVED',
    requiredIntegrations: ['GMAIL', 'GOOGLE_CALENDAR'],
    requiredCapabilities: ['EMAIL.READ', 'EMAIL.SEND', 'CALENDAR.CHECK_AVAILABILITY', 'CALENDAR.CREATE_EVENT'],
    configurationSchema: {
      calendarId: { type: 'string', label: 'Google Calendar', required: true },
      appointmentDurationMinutes: { type: 'number', label: 'Duration (Minutes)', required: true, default: 30 },
      timezone: { type: 'string', label: 'Timezone', required: true, default: 'UTC' },
      workingHours: { type: 'string', label: 'Working Hours', required: false, default: '09:00-17:00' },
      confirmationEmailEnabled: { type: 'boolean', label: 'Send Confirmation Email', required: false, default: true },
      alternativeSlotsCount: { type: 'number', label: 'Alternative Slots Count', required: false, default: 3 },
      approvalRequired: { type: 'boolean', label: 'Require Human Approval', required: false, default: false }
    },
    workflowDefinition: {
      trigger: {
        type: 'EMAIL_RECEIVED'
      },
      nodes: [
        {
          id: 'extract_request',
          type: 'AI_TASK',
          config: {
            task: 'Extract Appointment Request',
            prompt: "Extract the appointment request details from the following email. If the user asks for tomorrow, determine tomorrow's date based on current date. Email subject: {{trigger.email.subject}}. Email body: {{trigger.email.body}}",
            schema: {
              type: 'object',
              properties: {
                customerName: { type: 'string', description: 'Name of the customer requesting the appointment' },
                customerEmail: { type: 'string', description: 'Email of the customer' },
                requestedDate: { type: 'string', description: 'Requested date in YYYY-MM-DD format' },
                requestedTime: { type: 'string', description: 'Requested time in HH:mm format' },
                purpose: { type: 'string', description: 'Purpose of the appointment' }
              },
              required: ['customerName', 'customerEmail', 'requestedDate', 'requestedTime']
            }
          },
          next: ['check_availability']
        },
        {
          id: 'check_availability',
          type: 'TOOL_ACTION',
          config: {
            task: 'Check Calendar Availability',
            capability: 'CALENDAR.CHECK_AVAILABILITY',
            actionId: 'check_availability',
            inputs: {
              calendarId: '{{config.calendarId}}',
              date: '{{steps.extract_request.output.requestedDate}}',
              time: '{{steps.extract_request.output.requestedTime}}',
              durationMinutes: '{{config.appointmentDurationMinutes}}',
              timezone: '{{config.timezone}}'
            }
          },
          next: ['is_available']
        },
        {
          id: 'is_available',
          type: 'CONDITION',
          config: {
            condition: 'Available?',
            inputs: {
              expression: 'input.isAvailable === true'
            }
          },
          next: {
            'YES': 'create_event',
            'NO': 'find_alternatives',
            'ERROR': 'find_alternatives'
          }
        },
        {
          id: 'create_event',
          type: 'TOOL_ACTION',
          config: {
            task: 'Create Calendar Event',
            capability: 'CALENDAR.CREATE_EVENT',
            actionId: 'create_event',
            inputs: {
              calendarId: '{{config.calendarId}}',
              title: 'Appointment: {{steps.extract_request.output.customerName}} - {{steps.extract_request.output.purpose}}',
              date: '{{steps.extract_request.output.requestedDate}}',
              time: '{{steps.extract_request.output.requestedTime}}',
              durationMinutes: '{{config.appointmentDurationMinutes}}',
              timezone: '{{config.timezone}}',
              attendees: ['{{steps.extract_request.output.customerEmail}}']
            }
          },
          next: ['send_confirmation']
        },
        {
          id: 'send_confirmation',
          type: 'TOOL_ACTION',
          config: {
            task: 'Gmail Confirmation',
            capability: 'EMAIL.SEND',
            actionId: 'send_email',
            inputs: {
              to: '{{steps.extract_request.output.customerEmail}}',
              subject: 'Appointment Confirmed',
              body: 'Hi {{steps.extract_request.output.customerName}},\n\nYour appointment for {{steps.extract_request.output.requestedDate}} at {{steps.extract_request.output.requestedTime}} has been confirmed.\n\nBest regards,\nAgent Flux Team'
            }
          }
        },
        {
          id: 'find_alternatives',
          type: 'TOOL_ACTION',
          config: {
            task: 'Find Alternative Slots',
            capability: 'CALENDAR.CHECK_AVAILABILITY',
            actionId: 'find_alternatives',
            inputs: {
              calendarId: '{{config.calendarId}}',
              date: '{{steps.extract_request.output.requestedDate}}',
              durationMinutes: '{{config.appointmentDurationMinutes}}',
              timezone: '{{config.timezone}}',
              count: '{{config.alternativeSlotsCount}}'
            }
          },
          next: ['send_alternative_response']
        },
        {
          id: 'send_alternative_response',
          type: 'TOOL_ACTION',
          config: {
            task: 'Gmail Alternative Response',
            capability: 'EMAIL.SEND',
            actionId: 'send_email',
            inputs: {
              to: '{{steps.extract_request.output.customerEmail}}',
              subject: 'Appointment Request - Alternatives',
              body: 'Hi {{steps.extract_request.output.customerName}},\n\nUnfortunately, the requested time is not available. Please consider these alternative slots:\n\n{{steps.find_alternatives.output.slotsFormatted}}\n\nBest regards,\nAgent Flux Team'
            }
          }
        }
      ]
    },
    steps: [],
    riskLevel: 'MEDIUM'
  },

  // RENEWALS
  {
    slug: 'subscription-renewal',
    name: 'Subscription Renewal',
    category: 'RENEWALS',
    description: 'Send renewal notices before subscription expiration.',
    icon: null,
    triggerType: 'SCHEDULE',
    requiredIntegrations: ['GMAIL', 'STRIPE'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  },
  {
    slug: 'amc-renewal',
    name: 'AMC Renewal',
    category: 'RENEWALS',
    description: 'Remind customers about Annual Maintenance Contract renewals.',
    icon: null,
    triggerType: 'SCHEDULE',
    requiredIntegrations: ['GMAIL', 'CRM'],
    workflowDefinition: { nodes: [], edges: [] },
    steps: [],
    riskLevel: 'LOW'
  }
];

async function main() {
  console.log('Seeding WorkflowTemplates...');
  
  for (const t of templates) {
    await prisma.workflowTemplate.upsert({
      where: { slug: t.slug },
      update: {
        name: t.name,
        category: t.category,
        description: t.description,
        triggerType: t.triggerType,
        requiredIntegrations: t.requiredIntegrations,
        requiredCapabilities: (t as any).requiredCapabilities || [],
        workflowDefinition: Object.keys(t.workflowDefinition.nodes).length > 0 ? t.workflowDefinition : { nodes: t.steps, edges: [] },
        riskLevel: t.riskLevel as any,
      },
      create: {
        slug: t.slug,
        name: t.name,
        category: t.category,
        description: t.description,
        triggerType: t.triggerType,
        requiredIntegrations: t.requiredIntegrations,
        requiredCapabilities: (t as any).requiredCapabilities || [],
        workflowDefinition: Object.keys(t.workflowDefinition.nodes).length > 0 ? t.workflowDefinition : { nodes: t.steps, edges: [] },
        riskLevel: t.riskLevel as any,
      }
    });
  }

  console.log('Seeded templates successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
