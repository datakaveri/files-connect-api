/**
 * Test setup utilities
 */
import { Server } from "http";
import supertest from "supertest";
import { getAuthToken } from "./auth";
import app from "../../app";

// Enable better error messages for async tests
require("source-map-support").install();

type Request = ReturnType<typeof supertest.agent>;

/**
 * Test context interface with commonly used test utilities
 */
export interface TestContext {
  request: Request;
  server: Server;
  providerToken: string;
  consumerToken: string;
  baseUrl: string;
}

/**
 * Initialize test context
 * @returns Test context
 */
export const initTestContext = async (): Promise<TestContext> => {
  console.log("Starting test context initialization...");

  try {
    // Create a test server
    console.log("Creating test server...");
    const server = app.listen(0);

    // Add error handler for server
    server.on("error", (error) => {
      console.error("Test server error:", error);
    });

    // Wait for server to be ready
    await new Promise<void>((resolve) => {
      server.on("listening", () => {
        console.log("Test server is listening");
        resolve();
      });
    });

    const address = server.address();
    const port = typeof address === "string" ? 0 : address?.port || 0;

    if (port === 0) {
      throw new Error("Failed to get server port");
    }

    const baseUrl = `http://localhost:${port}`;
    console.log(`Test server running at ${baseUrl}`);

    const request = supertest.agent(baseUrl);

    console.log("Getting authentication tokens...");
    // Get tokens for different user types
    const [providerToken, consumerToken] = await Promise.all([
      getAuthToken(
        process.env.KEYCLOAK_TEST_USER_USERNAME!,
        process.env.KEYCLOAK_TEST_USER_PASSWORD!
      ),
      getAuthToken(
        process.env.KEYCLOAK_TEST_USER_USERNAME!,
        process.env.KEYCLOAK_TEST_USER_PASSWORD!
      ),
    ]);

    if (!providerToken || !consumerToken) {
      throw new Error("Failed to obtain authentication tokens");
    }

    console.log("Test context initialized successfully");

    return {
      request,
      server,
      providerToken,
      consumerToken,
      baseUrl,
    };
  } catch (error) {
    console.error("Error initializing test context:", error);
    throw error;
  }
};

/**
 * Clean up test context
 * @param context Test context
 */
export const cleanupTestContext = async (
  context: TestContext
): Promise<void> => {
  console.log("Starting test context cleanup...");

  if (!context || !context.server) {
    console.log("No server to close");
    return;
  }

  try {
    // Close the server
    await new Promise<void>((resolve, reject) => {
      context.server.close((err) => {
        if (err) {
          console.error("Error closing server:", err);
          reject(err);
        } else {
          console.log("Test server closed successfully");
          resolve();
        }
      });
    });
  } catch (error) {
    console.error("Error during test context cleanup:", error);
    throw error;
  } finally {
    console.log("Test context cleanup completed");
  }
};

/**
 * Generate a random string of specified length
 * @param length Length of the string
 * @returns Random string
 */
export function generateRandomString(length: number = 10): string {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

/**
 * Convert string to base64
 * @param str String to convert
 * @returns Base64 encoded string
 */
export function toBase64(str: string): string {
  return Buffer.from(str).toString("base64");
}
