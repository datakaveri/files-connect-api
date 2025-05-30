/**
 * Authentication utilities for tests
 */
import axios from "axios";
import { env } from "../../config/environment";

// Enable better error messages for async tests
require("source-map-support").install();

// Debug logging
const debug = process.env.DEBUG === "true";

/**
 * Interface for authentication response from Keycloak
 */
interface AuthResponse {
  access_token: string;
  expires_in: number;
  refresh_expires_in: number;
  refresh_token: string;
  token_type: string;
  "not-before-policy": number;
  session_state: string;
  scope: string;
  error?: string;
  error_description?: string;
}

/**
 * Get an authentication token from Keycloak
 * @param username Username for authentication
 * @param password Password for authentication
 * @returns Access token
 * @throws Error if authentication fails
 */
export async function getAuthToken(
  username: string,
  password: string
): Promise<string> {
  try {
    if (debug) {
      console.log(`Attempting to authenticate user: ${username}`);
    }

    // Use environment variables for configuration
    const authUrl = env.KEYCLOAK_AUTH_URL;
    const clientId = env.KEYCLOAK_CLIENT_ID;

    if (debug) {
      console.log(`Auth URL: ${authUrl}`);
      console.log(`Client ID: ${clientId}`);
    }

    // Create form data for the request
    const formData = new URLSearchParams();
    formData.append("grant_type", "password");
    formData.append("client_id", clientId);
    formData.append("username", username);
    formData.append("password", password);

    if (debug) {
      console.log("Sending authentication request...");
    }

    // Make the request with a timeout
    const response = await axios.post<AuthResponse>(
      authUrl,
      formData.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        timeout: 10000, // 10 second timeout
      }
    );

    if (response.data.error) {
      throw new Error(
        `Authentication failed: ${
          response.data.error_description || response.data.error
        }`
      );
    }

    if (!response.data.access_token) {
      throw new Error("No access token received in response");
    }

    if (debug) {
      console.log("Successfully authenticated user:", username);
    }

    return response.data.access_token;
  } catch (error) {
    console.error("Failed to get auth token:", error);
    throw new Error("Authentication failed");
  }
}
