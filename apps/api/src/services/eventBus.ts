import { EventDispatcher } from './workflow/eventDispatcher';

export class EventBus {
  /**
   * Publish an event to the system.
   * This is fire-and-forget for the caller, but the EventDispatcher will durably
   * find matching workflows and enqueue them.
   */
  static async publish(businessId: string, eventType: string, payload: any) {
    try {
      await EventDispatcher.dispatch(businessId, eventType, payload);
    } catch (err) {
      console.error(`Failed to dispatch event ${eventType} for business ${businessId}:`, err);
    }
  }
}
