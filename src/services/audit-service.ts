/**
 * Audit Service
 * Handles creating and publishing audit messages
 * Schema: V46__Create_user_activity_audit_log
 */
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import { env } from "../config/environment";
import { createLogger } from "../core/utils/logger";
import { RabbitMQServiceInterface } from "./rabbitmq-service";

// Create a logger for this module
const logger = createLogger("AuditService");

// Enum for audit log types matching database schema
export type AuditLogType = "ASSET" | "USER_ACTION" | "COMPUTE";

// Enum for HTTP methods
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

// Audit message matching user_activity_audit_log schema
export interface AuditMessage {
  // Primary key (auto-generated)
  id: string;

  // User context (mandatory)
  user_id: string;
  role: string;
  issuer: string;

  // User context (optional)
  org_id?: string;
  org_name?: string;
  org_type?: string;

  // Delegation (optional)
  delegator_id?: string;
  delegator_role?: string;

  // API metadata (mandatory)
  api: string;
  method: HttpMethod;
  action: string;
  origin_server: string;

  // Asset dimension (conditional - include if log_type is ASSET)
  asset_id?: string;
  asset_access_policy?: string;
  asset_org_id?: string;
  asset_org_name?: string;
  asset_org_type?: string;
  asset_provider_id?: string;
  asset_provider_name?: string;

  // Metrics / workflow
  amount?: number;
  request_id?: string;

  // Classification (mandatory)
  log_type: AuditLogType;

  // Technical metadata (optional)
  ip_address?: string;
  user_agent?: string;

  // Time (mandatory)
  created_at: string;

  // Extensible (optional)
  context?: Record<string, any>;
}

export interface AuditContext {
  // Asset/Databank ID
  databankId: string;

  // API metadata
  api: string;
  method: string;
  action: "Upload" | "Download" | "File Delete" | "View";

  // User context (mandatory)
  userId: string;
  role: string;

  // Auth token for extracting issuer and fetching asset info
  authToken?: string;

  // Organization info
  orgId?: string;
  orgName?: string;
  orgType?: string;

  // Delegation (optional)
  delegatorId?: string;
  delegatorRole?: string;

  // Technical metadata
  ipAddress?: string;
  userAgent?: string;

  // Metrics
  amount?: number;
  requestId?: string;

  // Log type - defaults to ASSET
  logType?: AuditLogType;

  // Additional context (optional)
  context?: Record<string, any>;
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
    accessPolicy?: string;
    ownerUserId?: string;
    provider?: {
      id?: string;
      name?: string;
    };
    resourceGroup?: string;
    [key: string]: any;
  }>;
  detail: string;
}

// Extended asset info including new fields from catalogue
export interface AssetInfo {
  asset_type: string;
  asset_name: string;
  short_description: string;
  access_policy?: string;
  asset_org_id?: string;
  asset_org_name?: string;
  asset_org_type?: string;
  provider_id?: string;
  provider_name?: string;
}

export interface AuditServiceInterface {
  publishAuditMessage(context: AuditContext): Promise<void>;
}

export class AuditService implements AuditServiceInterface {
  constructor(private rabbitmqService: RabbitMQServiceInterface) {}

  async publishAuditMessage(context: AuditContext): Promise<void> {
    try {
      // Extract organization info and issuer from JWT token if available
      let tokenInfo = {
        orgId: context.orgId,
        orgName: context.orgName,
        orgType: context.orgType,
        issuer: "",
        delegatorId: context.delegatorId,
        delegatorRole: context.delegatorRole,
      };

      if (context.authToken) {
        const decodedTokenInfo = this.decodeJWTToken(context.authToken);
        tokenInfo = {
          orgId: context.orgId || decodedTokenInfo.orgId,
          orgName: context.orgName || decodedTokenInfo.orgName,
          orgType: context.orgType || decodedTokenInfo.orgType,
          issuer: decodedTokenInfo.issuer || "",
          delegatorId: context.delegatorId || decodedTokenInfo.delegatorId,
          delegatorRole: context.delegatorRole || decodedTokenInfo.delegatorRole,
        };
      }

      // Fetch asset information from catalogue API
      const assetInfo = await this.fetchAssetInfo(context.databankId, context.authToken);

      // Determine log type - default to ASSET for file operations
      const logType: AuditLogType = context.logType || "ASSET";

      // Build audit message matching user_activity_audit_log schema
      const auditMessage: AuditMessage = {
        // Primary key
        id: uuidv4(),

        // User context (mandatory)
        user_id: context.userId,
        role: context.role.toLowerCase(),
        issuer: tokenInfo.issuer,

        // User context (optional - include if present)
        ...(tokenInfo.orgId && { org_id: tokenInfo.orgId }),
        ...(tokenInfo.orgName && { org_name: tokenInfo.orgName }),
        ...(tokenInfo.orgType && { org_type: tokenInfo.orgType }),

        // Delegation (optional - include if present)
        ...(tokenInfo.delegatorId && { delegator_id: tokenInfo.delegatorId }),
        ...(tokenInfo.delegatorRole && { delegator_role: tokenInfo.delegatorRole }),

        // API metadata (mandatory)
        api: context.api,
        method: context.method.toUpperCase() as HttpMethod,
        action: context.action,
        origin_server: "FILE",

        // Asset dimension (include for ASSET log type)
        ...(logType === "ASSET" && {
          asset_id: context.databankId,
          ...(assetInfo.access_policy && { asset_access_policy: assetInfo.access_policy }),
          ...(assetInfo.asset_org_id && { asset_org_id: assetInfo.asset_org_id }),
          ...(assetInfo.asset_org_name && { asset_org_name: assetInfo.asset_org_name }),
          ...(assetInfo.asset_org_type && { asset_org_type: assetInfo.asset_org_type }),
          ...(assetInfo.provider_id && { asset_provider_id: assetInfo.provider_id }),
          ...(assetInfo.provider_name && { asset_provider_name: assetInfo.provider_name }),
        }),

        // Metrics / workflow (optional - include if present)
        ...(context.amount !== undefined && context.amount > 0 && { amount: context.amount }),
        ...(context.requestId && { request_id: context.requestId }),

        // Classification (mandatory)
        log_type: logType,

        // Technical metadata (optional - include if present)
        ...(context.ipAddress && { ip_address: context.ipAddress }),
        ...(context.userAgent && { user_agent: context.userAgent }),

        // Time (mandatory)
        created_at: this.generateMicrosecondTimestamp(),

        // Extensible context (optional - include if present)
        ...(context.context && Object.keys(context.context).length > 0 && { context: context.context }),
      };

      // Publish to RabbitMQ
      await this.rabbitmqService.publishAuditMessage(auditMessage);

      logger.info("Audit message published successfully", {
        auditId: auditMessage.id,
        action: context.action,
        assetId: context.databankId,
        userId: context.userId,
        logType,
      });
    } catch (error) {
      logger.error("Failed to publish audit message", error as Error, {
        action: context.action,
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
   * Extended token info extracted from JWT
   */
  private decodeJWTToken(token: string): {
    orgId?: string;
    orgName?: string;
    orgType?: string;
    issuer?: string;
    delegatorId?: string;
    delegatorRole?: string;
  } {
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
        // Organization info
        orgId: decodedPayload.organisation_id,
        orgName: decodedPayload.organisation_name,
        orgType: decodedPayload.organisation_type || decodedPayload.org_type,
        
        // Issuer (mandatory in new schema)
        issuer: decodedPayload.iss,
        
        // Delegation info (optional) - check for act (actor) claim for delegation
        delegatorId: decodedPayload.act?.sub,
        delegatorRole: decodedPayload.act?.role || decodedPayload.delegator_role,
      };
    } catch (error) {
      logger.error('Failed to decode JWT token', error as Error);
      return {};
    }
  }

  private async fetchAssetInfo(databankId: string, authToken?: string): Promise<AssetInfo> {
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

          // Extract provider info if available
          const providerInfo = result.provider || {};

          return {
            asset_type: assetType ?? "adex:DataBank",
            asset_name: result.label || (result as any).name || "Unknown Asset",
            short_description: result.shortDescription || "No description available",
            
            // New fields for the updated schema
            access_policy: result.accessPolicy,
            asset_org_id: result.ownerUserId,  // Owner user ID maps to asset_org_id
            asset_org_name: (result as any).ownerOrgName || (result as any).organisationName,
            asset_org_type: (result as any).ownerOrgType || (result as any).organisationType,
            provider_id: providerInfo.id || (result as any).providerId,
            provider_name: providerInfo.name || (result as any).providerName,
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

  private getDefaultAssetInfo(): AssetInfo {
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
