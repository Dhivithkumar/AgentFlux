import { operationalSyncService } from '../operations/OperationalSyncService';
import { OperationalEntityType } from '../operations/types';

/**
 * Backward-compatible facade for SheetSyncService.
 * Delegates all sync actions directly to the single authoritative OperationalSyncService.
 */
export class SheetSyncService {
  public static async syncEntity(
    businessId: string,
    entityType: string,
    entityId: string
  ): Promise<void> {
    const normType = entityType.toUpperCase() as OperationalEntityType;
    await operationalSyncService.syncEntity(businessId, normType, entityId);
  }
}
