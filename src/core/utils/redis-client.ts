/**
 * Redis Client
 * Provides a singleton Redis client with connection management and retry logic
 */
import { createClient, RedisClientType } from "redis";
import { env } from "../../config/environment";
import { createLogger } from "./logger";

const logger = createLogger("RedisClient");

class RedisClient {
  private static instance: RedisClient;
  private client: RedisClientType | null = null;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance of RedisClient
   */
  public static getInstance(): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient();
    }
    return RedisClient.instance;
  }

  /**
   * Get the Redis client, connecting if necessary
   */
  public async getClient(): Promise<RedisClientType> {
    if (this.client && this.client.isOpen) {
      return this.client;
    }

    if (this.isConnecting) {
      // Wait for the current connection attempt to complete
      await this.waitForConnection();
      if (this.client && this.client.isOpen) {
        return this.client;
      }
      throw new Error("Failed to establish Redis connection");
    }

    return this.connect();
  }

  /**
   * Connect to Redis
   */
  private async connect(): Promise<RedisClientType> {
    this.isConnecting = true;

    try {
      logger.info("Connecting to Redis", {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
      });

      // Create Redis client with database number
      const redisUrl = env.REDIS_PASSWORD
        ? `redis://:${env.REDIS_PASSWORD}@${env.REDIS_HOST}:${env.REDIS_PORT}/${env.REDIS_DB}`
        : `redis://${env.REDIS_HOST}:${env.REDIS_PORT}/${env.REDIS_DB}`;

      this.client = createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries: number) => {
            if (retries > this.maxReconnectAttempts) {
              logger.error("Max Redis reconnection attempts reached");
              return new Error("Max reconnection attempts reached");
            }
            // Exponential backoff: 100ms, 200ms, 400ms, 800ms, etc.
            const delay = Math.min(100 * Math.pow(2, retries), 3000);
            logger.warn(`Redis reconnection attempt ${retries}, waiting ${delay}ms`);
            return delay;
          },
        },
      }) as RedisClientType;

      // Set up event handlers
      this.client.on("error", (err: Error) => {
        logger.error("Redis client error", err);
      });

      this.client.on("connect", () => {
        logger.info("Redis client connected");
        this.reconnectAttempts = 0;
      });

      this.client.on("ready", () => {
        logger.info("Redis client ready");
      });

      this.client.on("reconnecting", () => {
        this.reconnectAttempts++;
        logger.warn("Redis client reconnecting", {
          attempt: this.reconnectAttempts,
        });
      });

      this.client.on("end", () => {
        logger.warn("Redis client connection closed");
      });

      // Connect to Redis
      await this.client.connect();

      logger.info("Successfully connected to Redis");
      this.isConnecting = false;
      return this.client;
    } catch (error) {
      this.isConnecting = false;
      logger.error("Failed to connect to Redis", error as Error);
      throw error;
    }
  }

  /**
   * Wait for an ongoing connection attempt to complete
   */
  private async waitForConnection(): Promise<void> {
    const maxWaitTime = 10000; // 10 seconds
    const startTime = Date.now();

    while (this.isConnecting && Date.now() - startTime < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Disconnect from Redis
   */
  public async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        logger.info("Redis client disconnected");
      } catch (error) {
        logger.error("Error disconnecting Redis client", error as Error);
      }
      this.client = null;
    }
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.client !== null && this.client.isOpen;
  }
}

// Export singleton instance getter
export const getRedisClient = async (): Promise<RedisClientType> => {
  const redisClient = RedisClient.getInstance();
  return redisClient.getClient();
};

// Export connect function for eager connection on startup
export const connectRedis = async (): Promise<void> => {
  logger.info("Establishing Redis connection on startup");
  const redisClient = RedisClient.getInstance();
  await redisClient.getClient();
  logger.info("Redis connection established successfully");
};

// Export disconnect function for graceful shutdown
export const disconnectRedis = async (): Promise<void> => {
  const redisClient = RedisClient.getInstance();
  await redisClient.disconnect();
};

// Export connection check
export const isRedisConnected = (): boolean => {
  const redisClient = RedisClient.getInstance();
  return redisClient.isConnected();
};

