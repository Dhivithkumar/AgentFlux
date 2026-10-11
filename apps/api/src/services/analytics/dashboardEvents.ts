import EventEmitter from 'events';
import Redis from 'ioredis';

export interface DashboardEvent {
  businessId: string;
  eventType: string;
  payload: any;
  timestamp: string;
}

class DashboardEventBus {
  private localEmitter: EventEmitter = new EventEmitter();
  private publisherClient: Redis | null = null;
  private subscriberClient: Redis | null = null;
  private isRedisAvailable = false;
  private redisInitAttempted = false;
  private activeSubscriptions = new Map<string, Set<(event: DashboardEvent) => void>>();

  constructor() {
    this.localEmitter.setMaxListeners(200);
    this.initRedisSafely();
  }

  private initRedisSafely() {
    if (this.redisInitAttempted) return;
    this.redisInitAttempted = true;

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.log('[DashboardEventBus] REDIS_URL not configured. Using local in-memory event bus.');
      return;
    }

    try {
      this.publisherClient = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 4000,
        enableOfflineQueue: false,
        retryStrategy: () => null, // Do not hang or retry infinitely
      });

      this.publisherClient.on('connect', () => {
        this.isRedisAvailable = true;
        console.log('[DashboardEventBus] Connected to Redis Pub/Sub publisher.');
      });

      this.publisherClient.on('error', (err) => {
        // Log warning and fallback
        this.isRedisAvailable = false;
      });

      // Non-blocking initial connection attempt
      this.publisherClient.connect().catch(() => {
        this.isRedisAvailable = false;
      });
    } catch (e) {
      this.isRedisAvailable = false;
    }
  }

  private getSubscriber(): Redis | null {
    if (!process.env.REDIS_URL) return null;
    if (this.subscriberClient) return this.subscriberClient;

    try {
      this.subscriberClient = new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 4000,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });

      this.subscriberClient.on('error', () => {
        // Graceful error capture
      });

      this.subscriberClient.on('message', (channel: string, message: string) => {
        try {
          const parsed: DashboardEvent = JSON.parse(message);
          const listeners = this.activeSubscriptions.get(parsed.businessId);
          if (listeners) {
            listeners.forEach((fn) => {
              try {
                fn(parsed);
              } catch (err) {
                console.error('[DashboardEventBus] Listener error:', err);
              }
            });
          }
        } catch (e) {
          // Ignore malformed message
        }
      });

      this.subscriberClient.connect().catch(() => {
        // Non-blocking
      });

      return this.subscriberClient;
    } catch {
      return null;
    }
  }

  /**
   * Publish an operational update across processes for a given business
   */
  async publish(businessId: string, eventType: string, payload: any = {}): Promise<void> {
    const event: DashboardEvent = {
      businessId,
      eventType,
      payload,
      timestamp: new Date().toISOString(),
    };

    // 1. Always emit locally for in-process subscribers
    this.localEmitter.emit(`dashboard:${businessId}`, event);

    // 2. Cross-process publish via Redis if available
    if (this.publisherClient && this.isRedisAvailable) {
      try {
        const channel = `af:dashboard:${businessId}`;
        await this.publisherClient.publish(channel, JSON.stringify(event));
      } catch (err) {
        // Fallback to local only
        this.isRedisAvailable = false;
      }
    }
  }

  /**
   * Subscribe to live events for a specific business.
   * Returns an unsubscribe cleanup function.
   */
  subscribe(businessId: string, listener: (event: DashboardEvent) => void): () => void {
    // 1. Local subscription
    const localHandler = (event: DashboardEvent) => listener(event);
    this.localEmitter.on(`dashboard:${businessId}`, localHandler);

    // 2. Redis subscription tracking
    if (!this.activeSubscriptions.has(businessId)) {
      this.activeSubscriptions.set(businessId, new Set());
      const sub = this.getSubscriber();
      if (sub && sub.status === 'ready') {
        sub.subscribe(`af:dashboard:${businessId}`).catch(() => {});
      }
    }
    this.activeSubscriptions.get(businessId)!.add(listener);

    // Unsubscribe cleanup
    return () => {
      this.localEmitter.off(`dashboard:${businessId}`, localHandler);
      const listeners = this.activeSubscriptions.get(businessId);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.activeSubscriptions.delete(businessId);
          const sub = this.getSubscriber();
          if (sub && sub.status === 'ready') {
            sub.unsubscribe(`af:dashboard:${businessId}`).catch(() => {});
          }
        }
      }
    };
  }

  /**
   * Close connections cleanly during tests or shutdown
   */
  async cleanup(): Promise<void> {
    this.localEmitter.removeAllListeners();
    this.activeSubscriptions.clear();
    if (this.publisherClient) {
      try {
        await this.publisherClient.quit();
      } catch {
        this.publisherClient.disconnect();
      }
      this.publisherClient = null;
    }
    if (this.subscriberClient) {
      try {
        await this.subscriberClient.quit();
      } catch {
        this.subscriberClient.disconnect();
      }
      this.subscriberClient = null;
    }
  }
}

export const dashboardEventBus = new DashboardEventBus();
