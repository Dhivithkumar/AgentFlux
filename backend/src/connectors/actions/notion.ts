import { ConnectorAction, ConnectorExecutionContext } from '../types';

export const notionActions: ConnectorAction[] = [
  {
    id: 'notion.createPage',
    name: 'Create Notion Page / Database Item',
    description: 'Creates a new page or database entry in Notion',
    isWrite: true,
    inputSchema: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Notion Database ID to insert item into' },
        title: { type: 'string', description: 'Title or name for the page' },
        content: { type: 'string', description: 'Body text content' }
      },
      required: ['databaseId', 'title']
    },
    outputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        url: { type: 'string' }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const payload: any = {
        parent: { database_id: input.databaseId.replace(/-/g, '') },
        properties: {
          Name: {
            title: [
              {
                text: { content: input.title }
              }
            ]
          }
        }
      };

      if (input.content) {
        payload.children = [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [
                {
                  type: 'text',
                  text: { content: input.content }
                }
              ]
            }
          }
        ];
      }

      const response = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${context.accessToken}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(`Notion Error: ${resData?.message || response.statusText}`);
      }

      return {
        pageId: resData.id,
        url: resData.url
      };
    }
  }
];

