/**
 * Audit Service
 * Handles creating and publishing audit messages
 */
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import { env } from "../config/environment";
import { createLogger } from "../core/utils/logger";
import { RabbitMQServiceInterface } from "./rabbitmq-service";

// Create a logger for this module
const logger = createLogger("AuditService");

export interface AuditMessage {
  asset_id: string;
  api: string;
  method: string;
  asset_type: string;
  asset_name: string;
  created_at: string;
  user_id: string;
  role: string;
  operation: "Upload" | "Download" | "File Delete" | "View";
  short_description: string;
  myactivity_enabled: boolean;
  id: string;
  origin_server: string;
  org_name?: string;
  org_id?: string;
}

export interface AuditContext {
  databankId: string;
  api: string;
  method: string;
  userId: string;
  role: string;
  operation: "Upload" | "Download" | "File Delete" | "View";
  authToken?: string;
  orgId?: string;
  orgName?: string;
}

export interface CatalogueApiResponse {
  type: string;
  title: string;
  totalHits: number;
  result: Array<{
    id: string;
    label: string;
    shortDescription: string;
    type: string[];
    [key: string]: any;
  }>;
  detail: string;
}

export interface AuditServiceInterface {
  publishAuditMessage(context: AuditContext): Promise<void>;
}

export class AuditService implements AuditServiceInterface {
  constructor(private rabbitmqService: RabbitMQServiceInterface) {}

  async publishAuditMessage(context: AuditContext): Promise<void> {
    try {
      // Extract organization info from JWT token if available
      let orgInfo = { orgId: context.orgId, orgName: context.orgName };
      if (context.authToken && (!context.orgId || !context.orgName)) {
        const tokenOrgInfo = this.decodeJWTToken(context.authToken);
        orgInfo = {
          orgId: context.orgId || tokenOrgInfo.orgId,
          orgName: context.orgName || tokenOrgInfo.orgName
        };
      }

      // Fetch asset information from catalogue API
      const assetInfo = await this.fetchAssetInfo(context.databankId, context.authToken);

      // Build audit message (only include org fields if they exist)
      const auditMessage: AuditMessage = {
        asset_id: context.databankId,
        api: context.api,
        method: context.method,
        asset_type: assetInfo.asset_type,
        asset_name: assetInfo.asset_name,
        created_at: this.generateMicrosecondTimestamp(),
        user_id: context.userId,
        role: context.role.toLowerCase(),
        operation: context.operation,
        short_description: assetInfo.short_description,
        myactivity_enabled: true,
        id: uuidv4(),
        origin_server: "File",
        ...(orgInfo.orgName && { org_name: orgInfo.orgName }),
        ...(orgInfo.orgId && { org_id: orgInfo.orgId }),
      };

      // Publish to RabbitMQ
      await this.rabbitmqService.publishAuditMessage(auditMessage);

      logger.info("Audit message published successfully", {
        auditId: auditMessage.id,
        operation: context.operation,
        assetId: context.databankId,
        userId: context.userId,
      });
    } catch (error) {
      logger.error("Failed to publish audit message", error as Error, {
        operation: context.operation,
        assetId: context.databankId,
        userId: context.userId,
      });
      // Don't throw error to prevent breaking the main API flow
    }
  }

  /**
   * Generate timestamp in microsecond precision format: YYYY-MM-DDTHH:mm:ss.xxxxxx
   * Since JavaScript only supports millisecond precision, we pad with additional digits
   */
  private generateMicrosecondTimestamp(): string {
    const now = new Date();
    const milliseconds = now.getMilliseconds().toString().padStart(3, '0');
    
    // Generate additional 3 digits for microsecond precision
    // Using a combination of current microsecond counter and random for uniqueness
    const microsecondsExtra = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    
    // Format: YYYY-MM-DDTHH:mm:ss.xxxxxx
    const isoString = now.toISOString();
    const datePart = isoString.slice(0, 19); // "2025-06-30T12:41:36"
    
    return `${datePart}.${milliseconds}${microsecondsExtra}`;
  }

  /**
   * Decode JWT token to extract organization information
   */
  private decodeJWTToken(token: string): { orgId?: string; orgName?: string } {
    try {
      // Remove 'Bearer ' prefix if present
      const cleanToken = token.replace(/^Bearer\s+/i, '');
      
      // JWT tokens have 3 parts separated by dots: header.payload.signature
      const parts = cleanToken.split('.');
      if (parts.length !== 3) {
        logger.warn('Invalid JWT token format');
        return {};
      }

      // Decode the payload (second part)
      const payload = parts[1];
      if (!payload) {
        logger.warn('JWT token missing payload');
        return {};
      }
      
      // Add padding if necessary for base64 decoding
      const paddedPayload = payload + '='.repeat((4 - payload.length % 4) % 4);
      
      // Decode base64 and parse JSON
      const decodedPayload = JSON.parse(Buffer.from(paddedPayload, 'base64').toString());
      
      return {
        orgId: decodedPayload.organisation_id,
        orgName: decodedPayload.organisation_name
      };
    } catch (error) {
      logger.error('Failed to decode JWT token', error as Error);
      return {};
    }
  }

  private async fetchAssetInfo(databankId: string, authToken?: string): Promise<{
    asset_type: string;
    asset_name: string;
    short_description: string;
  }> {
    try {
      logger.debug("Fetching asset info from catalogue API", { databankId });

      // Prepare headers with optional authorization token
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
      };

      // Add authorization header if token is provided
      if (authToken) {
        headers.Authorization = authToken;
        logger.debug("Forwarding authorization token to catalogue API");
      }

      const response = await axios.get<CatalogueApiResponse>(`${env.CAT_API_URL}/item?id=${databankId}`, {
        timeout: 5000, // 5 second timeout
        headers,
      });

      if (response.data.result && response.data.result.length > 0) {
        const result = response.data.result[0];
        if (result) {
          let assetType: string | undefined;
          if (Array.isArray(result.type)) {
            assetType = result.type[0];
          } else if (typeof result.type === "string") {
            assetType = result.type;
          }
          return {
            asset_type: assetType ?? "adex:DataBank",
            asset_name: result.label || (result as any).name || "Unknown Asset",
            short_description: result.shortDescription || "No description available",
          };
        }
      } else {
        logger.warn("No results found in catalogue API response", { databankId });
      }
      return this.getDefaultAssetInfo();
    } catch (error) {
      logger.error("Failed to fetch asset info from catalogue API", error as Error, { databankId });
      return this.getDefaultAssetInfo();
    }
  }

  private getDefaultAssetInfo(): { asset_type: string; asset_name: string; short_description: string } {
    return {
      asset_type: "adex:DataBank",
      asset_name: "Unknown Asset",
      short_description: "No description available",
    };
  }
}

// Factory function to create audit service
export function createAuditService(rabbitmqService: RabbitMQServiceInterface): AuditServiceInterface {
  return new AuditService(rabbitmqService);
}
