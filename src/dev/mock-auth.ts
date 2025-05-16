/**
 * Mock Authentication Utilities for Development
 * 
 * This module provides utilities for generating mock JWT tokens and headers
 * for testing and development purposes.
 * 
 * WARNING: This should NEVER be used in production environments!
 */

import * as jwt from 'jsonwebtoken';
import { UserRole } from '../core/types/auth';

// Secret key for signing mock tokens (only for development)
const DEV_SECRET_KEY = 'development-secret-key-do-not-use-in-production';

interface MockUserOptions {
  userId?: string;
  roles?: UserRole[];
  expiresIn?: string | number;
  additionalClaims?: Record<string, any>;
}

/**
 * Generates a mock JWT token for development and testing
 * 
 * @param options - Configuration options for the mock token
 * @returns A signed JWT token string
 */
export function generateMockToken(options: MockUserOptions = {}): string {
  const {
    userId = 'mock-user-123',
    roles = [UserRole.CONSUMER],
    expiresIn = '1h',
    additionalClaims = {}
  } = options;

  // Create token payload
  const payload = {
    sub: userId,
    roles: roles,
    // Add standard JWT claims
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (typeof expiresIn === 'number' ? expiresIn : 3600),
    ...additionalClaims
  };

  // Sign the token
  return jwt.sign(payload, DEV_SECRET_KEY);
}

/**
 * Generates a mock Authorization header with a Bearer token
 * 
 * @param options - Configuration options for the mock token
 * @returns An Authorization header string
 */
export function generateMockAuthHeader(options: MockUserOptions = {}): string {
  const token = generateMockToken(options);
  return `Bearer ${token}`;
}

/**
 * Generates a complete set of mock headers for API requests
 * 
 * @param options - Configuration options for the mock user
 * @param databankId - Optional databank ID to include in headers
 * @returns Object containing all necessary headers for authenticated requests
 */
export function generateMockHeaders(options: MockUserOptions = {}, databankId: string = 'mock-databank-456'): Record<string, string> {
  return {
    'Authorization': generateMockAuthHeader(options),
    'X-Databank-ID': databankId,
    'Content-Type': 'application/json'
  };
}

/**
 * Example usage for different user roles
 */
export const mockExamples = {
  // Consumer user example
  consumerUser: {
    headers: generateMockHeaders({
      userId: 'consumer-123',
      roles: [UserRole.CONSUMER]
    }, 'databank-789')
  },
  
  // Provider user example
  providerUser: {
    headers: generateMockHeaders({
      userId: 'provider-456',
      roles: [UserRole.PROVIDER]
    }, 'databank-789')
  },
  
  // Admin user example (with multiple roles)
  adminUser: {
    headers: generateMockHeaders({
      userId: 'admin-789',
      roles: [UserRole.PROVIDER, UserRole.CONSUMER, UserRole.ADMIN]
    }, 'databank-789')
  }
};
