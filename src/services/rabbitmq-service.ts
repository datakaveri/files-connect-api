/**
 * RabbitMQ Service
 * Handles publishing audit messages to RabbitMQ
 */
import { connect } from "amqplib";
import { env } from "../config/environment";
import { createLogger } from "../core/utils/logger";

// Create a logger for this module
const logger = createLogger("RabbitMQService");

export interface RabbitMQServiceInterface {
  publishAuditMessage(message: object): Promise<void>;
  close(): Promise<void>;
}

export class RabbitMQService implements RabbitMQServiceInterface {
  private connection: any = null;
  private channel: any = null;
  private isConnected = false;

  constructor() {
    // Only attempt connection if all required env vars are present
    if (this.validateEnvironmentVariables()) {
      this.connect().catch((error) => {
        logger.error("Failed to initialize RabbitMQ connection", error as Error);
      });
    } else {
      logger.warn("RabbitMQ environment variables not properly configured, skipping connection");
    }
  }

  private validateEnvironmentVariables(): boolean {
    const requiredVars = [
      "RABBITMQ_HOST",
      "RABBITMQ_PORT",
      "RABBITMQ_USERNAME",
      "RABBITMQ_PASSWORD",
      "RABBITMQ_VHOST",
      "RABBITMQ_EXCHANGE",
      "RABBITMQ_ROUTING_KEY"
    ];

    const missingVars = requiredVars.filter(varName => {
      const value = (env as any)[varName];
      const isEmpty = !value || value.toString().trim() === "";
      
      // Debug logging to see actual values
      logger.debug(`Checking env var ${varName}`, { 
        value: value, 
        type: typeof value,
        isEmpty,
        trimmed: value ? value.toString().trim() : 'undefined'
      });
      
      return isEmpty;
    });

    if (missingVars.length > 0) {
      logger.warn("Missing required RabbitMQ environment variables", { missingVars });
      return false;
    }

    return true;
  }

  private async connect(): Promise<void> {
    try {
      // URL encode the username, password, and vhost to handle special characters
      const encodedUsername = encodeURIComponent(env.RABBITMQ_USERNAME);
      const encodedPassword = encodeURIComponent(env.RABBITMQ_PASSWORD);
      const encodedVhost = encodeURIComponent(env.RABBITMQ_VHOST);
      
      // Try both amqp and amqps (SSL) connection
      const protocol = env.RABBITMQ_HOST.includes('iudx.io') ? 'amqps' : 'amqp';
      const connectionUrl = `${protocol}://${encodedUsername}:${encodedPassword}@${env.RABBITMQ_HOST}:${env.RABBITMQ_PORT}/${encodedVhost}`;
      
      logger.debug("Attempting RabbitMQ connection", { 
        host: env.RABBITMQ_HOST, 
        port: env.RABBITMQ_PORT, 
        vhost: env.RABBITMQ_VHOST,
        username: env.RABBITMQ_USERNAME,
        protocol,
        connectionUrl: connectionUrl.replace(/\/\/.*@/, '//***:***@') // Hide credentials in logs
      });
      
      // Connection options for better error handling
      const connectionOptions = {
        heartbeat: 60,
        timeout: 10000, // 10 second timeout
      };
      
      this.connection = await connect(connectionUrl, connectionOptions);
      this.channel = await this.connection.createChannel();

      // Ensure the exchange exists (using 'direct' type to match existing exchange)
      await this.channel.assertExchange(env.RABBITMQ_EXCHANGE, "direct", { durable: true });

      this.isConnected = true;
      logger.info("Connected to RabbitMQ successfully");

      // Handle connection errors
      this.connection.on("error", (err: Error) => {
        logger.error("RabbitMQ connection error", err);
        this.isConnected = false;
      });

      this.connection.on("close", () => {
        logger.warn("RabbitMQ connection closed");
        this.isConnected = false;
      });

      // Handle channel errors
      this.channel.on("error", (err: Error) => {
        logger.error("RabbitMQ channel error", err);
        this.isConnected = false;
      });

      this.channel.on("close", () => {
        logger.warn("RabbitMQ channel closed");
        this.isConnected = false;
      });
    } catch (error) {
      logger.error("Failed to connect to RabbitMQ", error as Error, {
        host: env.RABBITMQ_HOST,
        port: env.RABBITMQ_PORT,
        vhost: env.RABBITMQ_VHOST,
        username: env.RABBITMQ_USERNAME,
        errorType: (error as Error).name
      });
      this.isConnected = false;
      throw error;
    }
  }

  async publishAuditMessage(message: object): Promise<void> {
    try {
      // Skip if not properly configured
      if (!this.validateEnvironmentVariables()) {
        logger.warn("Skipping audit message publication - RabbitMQ not configured");
        return;
      }

      if (!this.isConnected || !this.channel) {
        await this.connect();
      }

      if (!this.channel) {
        throw new Error("RabbitMQ channel not available");
      }

      const messageBuffer = Buffer.from(JSON.stringify(message));

      const published = this.channel.publish(env.RABBITMQ_EXCHANGE, env.RABBITMQ_ROUTING_KEY, messageBuffer, { persistent: true });

      if (!published) {
        logger.warn("Failed to publish message to RabbitMQ - channel buffer full");
      } else {
        logger.debug("Audit message published successfully", { routingKey: env.RABBITMQ_ROUTING_KEY });
      }
    } catch (error) {
      logger.error("Failed to publish audit message", error as Error);
      // Don't throw error to prevent breaking the main API flow
    }
  }

  async close(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }
      this.isConnected = false;
      logger.info("RabbitMQ connection closed");
    } catch (error) {
      logger.error("Error closing RabbitMQ connection", error as Error);
    }
  }
}

// Factory function to create RabbitMQ service
export function createRabbitMQService(): RabbitMQServiceInterface {
  return new RabbitMQService();
}
