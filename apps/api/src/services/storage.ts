import fs from 'fs';
import path from 'path';

export class StorageService {
  private readonly storageRoot = path.join(process.cwd(), 'uploads');

  constructor() {
    if (!fs.existsSync(this.storageRoot)) {
      fs.mkdirSync(this.storageRoot, { recursive: true });
    }
  }

  /**
   * Save a file to the local disk based on tenant and document IDs.
   */
  async storeDocument(businessId: string, knowledgeBaseId: string, documentId: string, fileBuffer: Buffer, extension: string): Promise<string> {
    const dir = path.join(this.storageRoot, businessId, 'knowledge', knowledgeBaseId, documentId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const filePath = path.join(dir, `original.${extension}`);
    await fs.promises.writeFile(filePath, fileBuffer);
    
    // Return a logical storage path that can be used later
    return `business/${businessId}/knowledge/${knowledgeBaseId}/${documentId}/original.${extension}`;
  }

  /**
   * Retrieve a document from the local disk.
   */
  async getDocumentBuffer(storagePath: string): Promise<Buffer> {
    const relativePath = storagePath.split('business/')[1];
    if (!relativePath) {
      throw new Error(`Invalid storage path: ${storagePath}`);
    }
    const absolutePath = path.join(this.storageRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }
    return fs.promises.readFile(absolutePath);
  }

  /**
   * Remove a document and its directory from the local disk.
   */
  async deleteDocument(storagePath: string): Promise<void> {
    const relativePath = storagePath.split('business/')[1];
    if (!relativePath) return;
    const absolutePath = path.join(this.storageRoot, relativePath);
    if (fs.existsSync(absolutePath)) {
      await fs.promises.unlink(absolutePath);
      // Try to remove the document directory as well
      const dir = path.dirname(absolutePath);
      try {
        fs.rmdirSync(dir);
      } catch (e) {
        // Directory might not be empty, ignore
      }
    }
  }
}

export const storageService = new StorageService();
