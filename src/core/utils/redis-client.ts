/**
 * Redis Client
 * Provides a singleton Redis client with connection management and retry logic
 * Supports both standalone and cluster modes
 */
import { createClient, createCluster, RedisClientType, RedisClusterType } from "redis";
import { env } from "../../config/environment";
import { createLogger } from "./logger";

const logger = createLogger("RedisClient");

// Union type for both client types
export type RedisConnection = RedisClientType | RedisClusterType;

function isClientClosedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ClientClosedError" || error.message === "The client is closed")
  );
}

class RedisClient {
  private static instance: RedisClient;
  private client: RedisConnection | null = null;
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
  public async getClient(): Promise<RedisConnection> {
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
   * Execute a Redis operation and recover once from a stale closed client.
   */
  public async execute<T>(
    operationName: string,
    operation: (client: RedisConnection) => Promise<T>
  ): Promise<T> {
    try {
      return await operation(await this.getClient());
    } catch (error) {
      if (!isClientClosedError(error)) {
        throw error;
      }

      logger.warn("Redis client was closed during operation; reconnecting and retrying once", {
        operationName,
      });

      await this.resetClient();
      return operation(await this.getClient());
    }
  }

  /**
   * Create a standalone Redis client
   */
  private createStandaloneClient(): RedisClientType {
    // Create Redis client with database number
    const redisUrl = env.REDIS_PASSWORD
      ? `redis://:${env.REDIS_PASSWORD}@${env.REDIS_HOST}:${env.REDIS_PORT}/${env.REDIS_DB}`
      : `redis://${env.REDIS_HOST}:${env.REDIS_PORT}/${env.REDIS_DB}`;

    logger.info("Creating standalone Redis client", {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      db: env.REDIS_DB,
    });

    return createClient({
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
  }

  /**
   * Create a Redis Cluster client
   */
  private createClusterClient(): RedisClusterType {
    logger.info("Creating Redis Cluster client", {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
    });

    // Note: Redis Cluster doesn't support database selection (always uses DB 0)
    if (env.REDIS_DB !== 0) {
      logger.warn(
        "REDIS_DB is set but Redis Cluster mode only supports database 0. Ignoring REDIS_DB setting."
      );
    }

    const clusterOptions: Parameters<typeof createCluster>[0] = {
      rootNodes: [
        {
          url: env.REDIS_PASSWORD
            ? `redis://:${env.REDIS_PASSWORD}@${env.REDIS_HOST}:${env.REDIS_PORT}`
            : `redis://${env.REDIS_HOST}:${env.REDIS_PORT}`,
        },
      ],
      defaults: {
        socket: {
          reconnectStrategy: (retries: number) => {
            if (retries > this.maxReconnectAttempts) {
              logger.error("Max Redis Cluster reconnection attempts reached");
              return new Error("Max reconnection attempts reached");
            }
            // Exponential backoff: 100ms, 200ms, 400ms, 800ms, etc.
            const delay = Math.min(100 * Math.pow(2, retries), 3000);
            logger.warn(`Redis Cluster reconnection attempt ${retries}, waiting ${delay}ms`);
            return delay;
          },
        },
        ...(env.REDIS_PASSWORD && { password: env.REDIS_PASSWORD }),
      },
    };

    return createCluster(clusterOptions) as RedisClusterType;
  }

  /**
   * Connect to Redis
   */
  private async connect(): Promise<RedisConnection> {
    this.isConnecting = true;

    try {
      const isClusterMode = env.REDIS_CLUSTER_MODE;

      logger.info("Connecting to Redis", {
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        clusterMode: isClusterMode,
      });

      // Create appropriate client based on mode
      if (isClusterMode) {
        this.client = this.createClusterClient();
      } else {
        this.client = this.createStandaloneClient();
      }

      // Set up event handlers
      this.client.on("error", (err: Error) => {
        logger.error("Redis client error", err);
      });

      this.client.on("connect", () => {
        logger.info("Redis client connected", { clusterMode: isClusterMode });
        this.reconnectAttempts = 0;
      });

      this.client.on("ready", () => {
        logger.info("Redis client ready", { clusterMode: isClusterMode });
      });

      this.client.on("reconnecting", () => {
        this.reconnectAttempts++;
        logger.warn("Redis client reconnecting", {
          attempt: this.reconnectAttempts,
          clusterMode: isClusterMode,
        });
      });

      this.client.on("end", () => {
        logger.warn("Redis client connection closed", { clusterMode: isClusterMode });
      });

      // Connect to Redis
      await this.client.connect();

      logger.info("Successfully connected to Redis", { clusterMode: isClusterMode });
      this.isConnecting = false;
      return this.client;
    } catch (error) {
      this.isConnecting = false;
      this.client = null;
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

  private async resetClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.isConnecting = false;

    if (client?.isOpen) {
      try {
        await client.disconnect();
      } catch (error) {
        logger.warn("Error disconnecting stale Redis client", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
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
export const getRedisClient = async (): Promise<RedisConnection> => {
  const redisClient = RedisClient.getInstance();
  return redisClient.getClient();
};

export const executeRedisCommand = async <T>(
  operationName: string,
  operation: (client: RedisConnection) => Promise<T>
): Promise<T> => {
  const redisClient = RedisClient.getInstance();
  return redisClient.execute(operationName, operation);
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
