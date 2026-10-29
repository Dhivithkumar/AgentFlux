import { KnowledgeSource } from '@prisma/client';

export interface KnowledgeItem {
  externalId: string;
  title: string;
  content: string;
  mimeType: string;
  url?: string;
  modifiedAt?: Date;
  metadata?: any;
}

export interface KnowledgeSourceAdapter {
  /**
   * Fetch all items from the source to be processed and indexed.
   */
  sync(source: KnowledgeSource): Promise<KnowledgeItem[]>;

  /**
   * Test the connection to the source.
   */
  testConnection(source: KnowledgeSource): Promise<boolean>;
}
