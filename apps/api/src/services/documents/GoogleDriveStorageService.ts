import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { prisma } from '@agent-flux/database';
import { decrypt, encrypt } from '../encryption';

export class DriveSetupRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriveSetupRequiredError';
  }
}

export class DrivePermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DrivePermissionDeniedError';
  }
}

export interface DriveUploadResult {
  fileId: string;
  webViewLink: string;
  webContentLink?: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  folderId: string;
  isUpdate: boolean;
}

export class GoogleDriveStorageService {
  /**
   * Retrieves an authenticated Google Drive client for the given business.
   * Automatically decrypts credentials, refreshes tokens near expiry,
   * updates the database credentials, and flags RECONNECT_REQUIRED on failure.
   */
  async getDriveClient(businessId: string): Promise<drive_v3.Drive> {
    const integration = await prisma.integration.findFirst({
      where: {
        businessId,
        provider: 'GOOGLE_DRIVE',
        status: 'CONNECTED'
      },
      include: { credential: true }
    });

    if (!integration || !integration.credential) {
      throw new DriveSetupRequiredError(
        `Google Drive integration not connected for business ${businessId}. Setup required.`
      );
    }

    if (integration.status === 'RECONNECT_REQUIRED') {
      throw new DrivePermissionDeniedError(
        'Google Drive integration requires reconnection before operations can proceed.'
      );
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth client configuration missing from environment.');
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    let accessToken = decrypt(integration.credential.accessTokenEncrypted);

    // Auto-refresh token if close to expiry (within 60s) or already expired
    const isExpiringSoon =
      integration.credential.expiresAt &&
      integration.credential.expiresAt.getTime() < Date.now() + 60000;

    if (isExpiringSoon && integration.credential.refreshTokenEncrypted) {
      try {
        const refreshToken = decrypt(integration.credential.refreshTokenEncrypted);
        auth.setCredentials({ refresh_token: refreshToken });
        const { credentials } = await auth.refreshAccessToken();

        accessToken = credentials.access_token!;
        const updatedEncrypted = encrypt(accessToken);
        const newExpiry = credentials.expiry_date
          ? new Date(credentials.expiry_date)
          : new Date(Date.now() + 3600 * 1000);

        await prisma.integrationCredential.update({
          where: { id: integration.credential.id },
          data: {
            accessTokenEncrypted: updatedEncrypted,
            expiresAt: newExpiry
          }
        });

        auth.setCredentials({
          access_token: accessToken,
          refresh_token: refreshToken
        });
      } catch (refreshErr: any) {
        console.error('[GoogleDriveStorageService] Token refresh failed:', refreshErr.message);
        const isAuthError =
          refreshErr.response?.status === 400 ||
          refreshErr.response?.status === 401 ||
          refreshErr.message?.includes('invalid_grant');

        if (isAuthError) {
          await prisma.integration.update({
            where: { id: integration.id },
            data: { status: 'RECONNECT_REQUIRED' }
          });
          throw new DrivePermissionDeniedError(
            'Google Drive integration token expired and refresh failed. Reconnection required.'
          );
        }
        throw refreshErr;
      }
    } else {
      if (integration.credential.refreshTokenEncrypted) {
        const refreshToken = decrypt(integration.credential.refreshTokenEncrypted);
        auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
      } else {
        auth.setCredentials({ access_token: accessToken });
      }
    }

    return google.drive({ version: 'v3', auth });
  }

  /**
   * Ensures that a folder path exists in Google Drive, creating intermediate folders
   * as needed. Starting from root ('root').
   * Prevents duplicate folder creation by querying exact folder names under each parent.
   */
  async ensureDirectoryPath(drive: drive_v3.Drive, pathSegments: string[]): Promise<string> {
    let currentParentId = 'root';

    for (const segment of pathSegments) {
      const sanitized = segment.replace(/'/g, "\\'");
      const query = `mimeType = 'application/vnd.google-apps.folder' and name = '${sanitized}' and '${currentParentId}' in parents and trashed = false`;

      const res = await drive.files.list({
        q: query,
        fields: 'files(id, name)',
        spaces: 'drive',
        pageSize: 10
      });

      const existingFolder = res.data.files?.[0];
      if (existingFolder && existingFolder.id) {
        currentParentId = existingFolder.id;
      } else {
        // Create folder under current parent
        const created = await drive.files.create({
          requestBody: {
            name: segment,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [currentParentId]
          },
          fields: 'id, name'
        });

        if (!created.data.id) {
          throw new Error(`Failed to create Drive folder: ${segment}`);
        }
        currentParentId = created.data.id;
      }
    }

    return currentParentId;
  }

  /**
   * Uploads or updates a PDF document in Google Drive.
   * Path: Agent Flux / <Business Name> / <Document Type (Quotations | Invoices)>
   * Uses deterministic identity: `${documentNumber}.pdf`.
   * If a file with that name exists in the folder or if existingDriveFileId is provided,
   * updates the existing file rather than creating a duplicate.
   * Preserves least-privilege permissions (no public sharing).
   */
  async uploadOrUpdateDocument(
    businessId: string,
    options: {
      documentType: 'QUOTATION' | 'INVOICE';
      documentNumber: string;
      pdfBuffer: Buffer;
      existingDriveFileId?: string | null;
    }
  ): Promise<DriveUploadResult> {
    const drive = await this.getDriveClient(businessId);

    // Fetch business name for folder structure
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true }
    });
    const businessFolderName = (business?.name || `Business_${businessId}`).trim();
    const folderType = options.documentType === 'QUOTATION' ? 'Quotations' : 'Invoices';

    // 1. Ensure folder hierarchy: Agent Flux / <Business Name> / <Quotations|Invoices>
    const folderPath = ['Agent Flux', businessFolderName, folderType];
    const targetFolderId = await this.ensureDirectoryPath(drive, folderPath);

    // 2. Deterministic filename
    const sanitizedNumber = options.documentNumber.replace(/[/\\?%*:|"<>]/g, '-');
    const deterministicFileName = `${sanitizedNumber}.pdf`;

    // 3. Check for existing file
    let targetFileId: string | null = options.existingDriveFileId || null;

    if (targetFileId) {
      try {
        const existingCheck = await drive.files.get({
          fileId: targetFileId,
          fields: 'id, trashed'
        });
        if (existingCheck.data.trashed) {
          targetFileId = null; // Remote file was trashed, recreate
        }
      } catch (err: any) {
        if (err.status === 404 || err.code === 404) {
          targetFileId = null; // Remote file deleted, recreate
        } else {
          throw err;
        }
      }
    }

    // If targetFileId not known or was deleted, search in the target folder by name
    if (!targetFileId) {
      const escapedName = deterministicFileName.replace(/'/g, "\\'");
      const searchRes = await drive.files.list({
        q: `name = '${escapedName}' and '${targetFolderId}' in parents and trashed = false`,
        fields: 'files(id, name, webViewLink)',
        spaces: 'drive',
        pageSize: 10
      });

      if (searchRes.data.files && searchRes.data.files.length > 0) {
        targetFileId = searchRes.data.files[0].id!;
      }
    }

    // 4. Update or Create
    const mediaStream = Readable.from(options.pdfBuffer);

    if (targetFileId) {
      // Update existing file content
      const updated = await drive.files.update({
        fileId: targetFileId,
        media: {
          mimeType: 'application/pdf',
          body: mediaStream
        },
        fields: 'id, name, webViewLink, webContentLink, mimeType, size'
      });

      return {
        fileId: updated.data.id || targetFileId,
        webViewLink:
          updated.data.webViewLink || `https://drive.google.com/file/d/${targetFileId}/view`,
        webContentLink: updated.data.webContentLink || undefined,
        fileName: deterministicFileName,
        mimeType: 'application/pdf',
        fileSize: options.pdfBuffer.length,
        folderId: targetFolderId,
        isUpdate: true
      };
    } else {
      // Create new file
      const created = await drive.files.create({
        requestBody: {
          name: deterministicFileName,
          parents: [targetFolderId],
          mimeType: 'application/pdf'
        },
        media: {
          mimeType: 'application/pdf',
          body: mediaStream
        },
        fields: 'id, name, webViewLink, webContentLink, mimeType, size'
      });

      if (!created.data.id) {
        throw new Error('Google Drive upload failed: No file ID returned.');
      }

      return {
        fileId: created.data.id,
        webViewLink:
          created.data.webViewLink || `https://drive.google.com/file/d/${created.data.id}/view`,
        webContentLink: created.data.webContentLink || undefined,
        fileName: deterministicFileName,
        mimeType: 'application/pdf',
        fileSize: options.pdfBuffer.length,
        folderId: targetFolderId,
        isUpdate: false
      };
    }
  }

  /**
   * Verifies access and permission settings of a file in Google Drive.
   * Ensures the file is NOT publicly accessible by default (least privilege).
   */
  async verifyFileSecurity(
    businessId: string,
    fileId: string
  ): Promise<{ fileId: string; name: string; isPublic: boolean; permissionsCount: number }> {
    const drive = await this.getDriveClient(businessId);

    const fileMeta = await drive.files.get({
      fileId,
      fields: 'id, name, trashed'
    });

    const permRes = await drive.permissions.list({
      fileId,
      fields: 'permissions(id, type, role)'
    });

    const permissions = permRes.data.permissions || [];
    const isPublic = permissions.some(
      (p) => p.type === 'anyone' || (p.type === 'anyoneWithLink' as any)
    );

    return {
      fileId: fileMeta.data.id || fileId,
      name: fileMeta.data.name || '',
      isPublic,
      permissionsCount: permissions.length
    };
  }
}

export const googleDriveStorageService = new GoogleDriveStorageService();
