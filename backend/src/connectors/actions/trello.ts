import { ConnectorAction, ConnectorExecutionContext } from '../types';
import { prisma } from '@agent-flux/database';
import { decrypt } from '../../services/encryption';

export const trelloActions: ConnectorAction[] = [
  {
    id: 'trello.createCard',
    name: 'Create Trello Card',
    description: 'Creates a new card on a specified Trello board/list',
    isWrite: true,
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'Trello List ID' },
        name: { type: 'string', description: 'Card title' },
        desc: { type: 'string', description: 'Card description' }
      },
      required: ['listId', 'name']
    },
    outputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string' },
        url: { type: 'string' }
      }
    },
    async execute(context: ConnectorExecutionContext, input: any) {
      const integration = await prisma.integration.findFirst({
        where: { businessId: context.businessId, provider: 'TRELLO', status: 'CONNECTED' },
        include: { credential: true }
      });

      if (!integration || !integration.credential) {
        throw new Error('Trello integration not configured for this business.');
      }

      const apiKey = decrypt(integration.credential.accessTokenEncrypted);
      const apiToken = integration.credential.refreshTokenEncrypted
        ? decrypt(integration.credential.refreshTokenEncrypted)
        : '';

      const url = new URL('https://api.trello.com/1/cards');
      url.searchParams.append('idList', input.listId);
      url.searchParams.append('name', input.name);
      if (input.desc) url.searchParams.append('desc', input.desc);
      url.searchParams.append('key', apiKey);
      url.searchParams.append('token', apiToken);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { Accept: 'application/json' }
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(`Trello Error: ${resData?.message || response.statusText}`);
      }

      return {
        cardId: resData.id,
        url: resData.shortUrl || resData.url
      };
    }
  }
];

