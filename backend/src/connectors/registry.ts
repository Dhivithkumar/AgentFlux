import { ConnectorDefinition, ConnectorProvider } from './types';
import { GoogleConnectorProvider } from './providers/google';
import { gmailActions, gmailTriggers } from './actions/gmail';
import { googleCalendarActions } from './actions/googleCalendar';
import { googleDriveActions } from './actions/googleDrive';
import { googleSheetsActions } from './actions/googleSheets';

export const CONNECTORS: ConnectorDefinition[] = [
  // COMMUNICATION
  { id: 'GMAIL', name: 'Gmail', category: 'COMMUNICATION', description: 'Business email automation', logo: 'https://upload.wikimedia.org/wikipedia/commons/7/7e/Gmail_icon_%282020%29.svg', defaultScopes: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.modify'], status: 'available', capabilities: ['EMAIL.READ', 'EMAIL.SEARCH', 'EMAIL.SEND', 'EMAIL.REPLY'], actions: gmailActions, triggers: gmailTriggers },
  { id: 'SLACK', name: 'Slack', category: 'COMMUNICATION', description: 'Team messaging and notifications', logo: 'https://upload.wikimedia.org/wikipedia/commons/d/d5/Slack_icon_2019.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'MS_TEAMS', name: 'Microsoft Teams', category: 'COMMUNICATION', description: 'Enterprise communication', logo: 'https://upload.wikimedia.org/wikipedia/commons/c/c9/Microsoft_Office_Teams_%282018%E2%80%93present%29.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'OUTLOOK', name: 'Outlook', category: 'COMMUNICATION', description: 'Microsoft email', logo: 'https://upload.wikimedia.org/wikipedia/commons/d/df/Microsoft_Office_Outlook_%282018%E2%80%93present%29.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'WHATSAPP', name: 'WhatsApp Business', category: 'COMMUNICATION', description: 'Customer messaging', logo: 'https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },

  // PRODUCTIVITY
  { id: 'GOOGLE_CALENDAR', name: 'Google Calendar', category: 'PRODUCTIVITY', description: 'Scheduling and meetings', logo: 'https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg', defaultScopes: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/calendar'], status: 'available', capabilities: ['CALENDAR.LIST_EVENTS', 'CALENDAR.CREATE_EVENT', 'CALENDAR.CHECK_AVAILABILITY'], actions: googleCalendarActions, triggers: [] },
  { id: 'NOTION', name: 'Notion', category: 'PRODUCTIVITY', description: 'Workspace and docs', logo: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Notion_app_logo.png', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'TRELLO', name: 'Trello', category: 'PRODUCTIVITY', description: 'Project management', logo: 'https://upload.wikimedia.org/wikipedia/en/8/8c/Trello_logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'ASANA', name: 'Asana', category: 'PRODUCTIVITY', description: 'Task tracking', logo: 'https://upload.wikimedia.org/wikipedia/commons/3/3b/Asana_logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'CLICKUP', name: 'ClickUp', category: 'PRODUCTIVITY', description: 'All-in-one productivity', logo: 'https://upload.wikimedia.org/wikipedia/commons/4/4c/Clickup_logo.png', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },

  // GOOGLE WORKSPACE
  { id: 'GOOGLE_SHEETS', name: 'Google Sheets', category: 'GOOGLE WORKSPACE', description: 'Business data and spreadsheets', logo: 'https://upload.wikimedia.org/wikipedia/commons/3/30/Google_Sheets_logo_%282014-2020%29.svg', defaultScopes: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.readonly'], status: 'available', actions: googleSheetsActions, triggers: [] },
  { id: 'GOOGLE_DRIVE', name: 'Google Drive', category: 'GOOGLE WORKSPACE', description: 'Files and documents', logo: 'https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg', defaultScopes: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/drive'], status: 'available', actions: googleDriveActions, triggers: [] },
  { id: 'GOOGLE_DOCS', name: 'Google Docs', category: 'GOOGLE WORKSPACE', description: 'Document editing', logo: 'https://upload.wikimedia.org/wikipedia/commons/0/01/Google_Docs_logo_%282014-2020%29.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'GOOGLE_FORMS', name: 'Google Forms', category: 'GOOGLE WORKSPACE', description: 'Surveys and forms', logo: 'https://upload.wikimedia.org/wikipedia/commons/5/5b/Google_Forms_2020_Logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },

  // CRM
  { id: 'HUBSPOT', name: 'HubSpot', category: 'CRM', description: 'Inbound marketing and sales', logo: 'https://upload.wikimedia.org/wikipedia/en/3/3f/HubSpot_Logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'SALESFORCE', name: 'Salesforce', category: 'CRM', description: 'Customer relationship management', logo: 'https://upload.wikimedia.org/wikipedia/commons/f/f9/Salesforce.com_logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'ZOHO_CRM', name: 'Zoho CRM', category: 'CRM', description: 'Sales pipeline tracking', logo: 'https://upload.wikimedia.org/wikipedia/commons/e/ec/Zoho_Logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'PIPEDRIVE', name: 'Pipedrive', category: 'CRM', description: 'Sales CRM', logo: 'https://upload.wikimedia.org/wikipedia/en/0/0f/Pipedrive_logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },

  // E-COMMERCE
  { id: 'SHOPIFY', name: 'Shopify', category: 'E-COMMERCE', description: 'Online store automation', logo: 'https://upload.wikimedia.org/wikipedia/commons/0/0e/Shopify_logo_2018.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'WOOCOMMERCE', name: 'WooCommerce', category: 'E-COMMERCE', description: 'WordPress e-commerce', logo: 'https://upload.wikimedia.org/wikipedia/commons/2/2a/WooCommerce_logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },

  // PAYMENTS
  { id: 'STRIPE', name: 'Stripe', category: 'PAYMENTS', description: 'Payment processing', logo: 'https://upload.wikimedia.org/wikipedia/commons/b/ba/Stripe_Logo%2C_revised_2016.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'RAZORPAY', name: 'Razorpay', category: 'PAYMENTS', description: 'India payments', logo: 'https://upload.wikimedia.org/wikipedia/commons/8/89/Razorpay_logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'PAYPAL', name: 'PayPal', category: 'PAYMENTS', description: 'Global payments', logo: 'https://upload.wikimedia.org/wikipedia/commons/b/b5/PayPal.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },

  // STORAGE / DATA
  { id: 'DROPBOX', name: 'Dropbox', category: 'STORAGE / DATA', description: 'Cloud file storage', logo: 'https://upload.wikimedia.org/wikipedia/commons/c/cb/Dropbox_logo_2017.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'ONEDRIVE', name: 'OneDrive', category: 'STORAGE / DATA', description: 'Microsoft storage', logo: 'https://upload.wikimedia.org/wikipedia/commons/3/3c/Microsoft_Office_OneDrive_%282018%E2%80%93present%29.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'AIRTABLE', name: 'Airtable', category: 'STORAGE / DATA', description: 'Spreadsheet database', logo: 'https://upload.wikimedia.org/wikipedia/commons/4/4b/Airtable_Logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },

  // DEVELOPMENT
  { id: 'GITHUB', name: 'GitHub', category: 'DEVELOPMENT', description: 'Code repositories', logo: 'https://upload.wikimedia.org/wikipedia/commons/9/91/Octicons-mark-github.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'GITLAB', name: 'GitLab', category: 'DEVELOPMENT', description: 'DevOps platform', logo: 'https://upload.wikimedia.org/wikipedia/commons/e/e1/GitLab_logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'JIRA', name: 'Jira', category: 'DEVELOPMENT', description: 'Issue tracking', logo: 'https://upload.wikimedia.org/wikipedia/commons/8/8a/Jira_Logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'BITBUCKET', name: 'Bitbucket', category: 'DEVELOPMENT', description: 'Git repositories', logo: 'https://upload.wikimedia.org/wikipedia/commons/0/0e/Bitbucket-blue-logomark-only.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },

  // MARKETING / ANALYTICS
  { id: 'GOOGLE_ANALYTICS', name: 'Google Analytics', category: 'MARKETING', description: 'Web traffic tracking', logo: 'https://upload.wikimedia.org/wikipedia/commons/c/cd/Google_Analytics_Logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'GOOGLE_ADS', name: 'Google Ads', category: 'MARKETING', description: 'PPC advertising', logo: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Google_Ads_logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'META_ADS', name: 'Meta Ads', category: 'MARKETING', description: 'Facebook/Instagram ads', logo: 'https://upload.wikimedia.org/wikipedia/commons/7/7b/Meta_Platforms_Inc._logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'MAILCHIMP', name: 'Mailchimp', category: 'MARKETING', description: 'Email marketing campaigns', logo: 'https://upload.wikimedia.org/wikipedia/commons/c/c9/Mailchimp_Freddie_Icon_Black.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'BREVO', name: 'Brevo', category: 'MARKETING', description: 'Email and SMS marketing', logo: 'https://upload.wikimedia.org/wikipedia/commons/4/4c/Brevo_Logo.png', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },

  // AI
  { id: 'OPENAI', name: 'OpenAI', category: 'AI', description: 'GPT models', logo: 'https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'GEMINI', name: 'Gemini', category: 'AI', description: 'Google AI models', logo: 'https://upload.wikimedia.org/wikipedia/commons/8/8a/Google_Gemini_logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'GROQ', name: 'Groq', category: 'AI', description: 'Fast inference', logo: 'https://upload.wikimedia.org/wikipedia/commons/6/6b/Groq_logo.png', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] },
  { id: 'HUGGINGFACE', name: 'Hugging Face', category: 'AI', description: 'Open source models', logo: 'https://upload.wikimedia.org/wikipedia/commons/e/e6/Hugging_Face_logo.svg', defaultScopes: [], status: 'coming_soon', actions: [], triggers: [] }
];

const CONNECTORS_MAP = CONNECTORS.reduce((acc, c) => {
  acc[c.id] = c;
  return acc;
}, {} as Record<string, ConnectorDefinition>);

const providerInstances: Record<string, ConnectorProvider> = {};

export function getConnectorDefinition(id: string): ConnectorDefinition {
  const def = CONNECTORS_MAP[id];
  if (!def) {
    throw new Error(`Unknown connector ID: ${id}`);
  }
  return def;
}

export function getConnectorProvider(id: string): ConnectorProvider {
  if (providerInstances[id]) {
    return providerInstances[id];
  }

  const def = getConnectorDefinition(id);
  if (def.status === 'coming_soon') {
    throw new Error(`Connector ${id} is not yet implemented.`);
  }

  // Right now, all available ones are backed by Google OAuth
  if (['GMAIL', 'GOOGLE_CALENDAR', 'GOOGLE_SHEETS', 'GOOGLE_DRIVE'].includes(id)) {
    providerInstances[id] = new GoogleConnectorProvider(id);
    return providerInstances[id];
  }

  throw new Error(`Provider implementation not found for: ${id}`);
}

export function getAllConnectors(): ConnectorDefinition[] {
  return CONNECTORS;
}
