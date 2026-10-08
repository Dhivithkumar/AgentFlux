import { prisma } from '@agent-flux/database';
import { DocumentType, DocumentTemplateStatus } from '@agent-flux/database';

export class TemplateService {
  async getTemplates(businessId: string, type?: DocumentType) {
    const where: any = { businessId };
    if (type) where.documentType = type;
    
    return prisma.documentTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
  }

  async getActiveTemplate(businessId: string, type: DocumentType) {
    return prisma.documentTemplate.findFirst({
      where: { businessId, documentType: type, status: 'ACTIVE' },
      orderBy: { version: 'desc' }
    });
  }

  async createTemplate(businessId: string, data: {
    documentType: DocumentType;
    name: string;
    templateFileId?: string;
    sampleFileId?: string;
    mapping?: any;
  }, userId: string) {
    // Find latest version
    const latest = await prisma.documentTemplate.findFirst({
      where: { businessId, documentType: data.documentType },
      orderBy: { version: 'desc' }
    });

    const newVersion = latest ? latest.version + 1 : 1;

    return prisma.documentTemplate.create({
      data: {
        businessId,
        documentType: data.documentType,
        name: data.name,
        version: newVersion,
        status: 'DRAFT',
        templateFileId: data.templateFileId,
        sampleFileId: data.sampleFileId,
        mapping: data.mapping,
        createdBy: userId
      }
    });
  }

  async updateTemplate(businessId: string, templateId: string, data: any) {
    return prisma.documentTemplate.update({
      where: { id: templateId, businessId },
      data
    });
  }

  async activateTemplate(businessId: string, templateId: string) {
    const template = await prisma.documentTemplate.findUnique({
      where: { id: templateId, businessId }
    });

    if (!template) throw new Error('Template not found');

    // Deactivate all others of same type
    await prisma.documentTemplate.updateMany({
      where: { businessId, documentType: template.documentType, status: 'ACTIVE' },
      data: { status: 'ARCHIVED' }
    });

    // Activate this one
    return prisma.documentTemplate.update({
      where: { id: templateId },
      data: { status: 'ACTIVE' }
    });
  }
}

export const templateService = new TemplateService();
