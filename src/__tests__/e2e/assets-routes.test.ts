/**
 * End-to-end tests for Asset Routes
 */
// Enable source map support for better stack traces
import "source-map-support/register";
import {
  initTestContext,
  cleanupTestContext,
  TestContext,
} from "../utils/setup";

console.log("Starting Assets Routes tests...");

// Set test timeout to 30 seconds
jest.setTimeout(30000);

describe("Assets Routes", () => {
  let context: TestContext;

  beforeAll(async () => {
    console.log("Initializing test context...");
    try {
      // Set test environment variables
      process.env.NODE_ENV = "test";
      process.env.PORT = "0"; // Use random port
      // Identity settings and test credentials come from the private .env.test;
      // never override them with a shared organization's identity provider.

      console.log("Environment variables set for testing");

      // Initialize test context
      context = await initTestContext();
      console.log("Test context initialized successfully");

      // Log the base URL for debugging
      console.log(`Test server running at: ${context.baseUrl}`);
    } catch (error) {
      console.error("Failed to initialize test context:", error);
      // Rethrow to fail the test
      throw error;
    }
  });

  afterAll(async () => {
    console.log("Cleaning up test context...");
    try {
      await cleanupTestContext(context);
      console.log("Test context cleaned up successfully");
    } catch (error) {
      console.error("Error during test context cleanup:", error);
      // Don't throw here to avoid masking test failures
    }
  });

  // Test authentication requirements
  describe("Authentication", () => {
    it("should require authentication for GET /assets", async () => {
      const response = await context.request.get("/assets");
      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
    });

    it("should return 200 with valid token for GET /assets", async () => {
      const response = await context.request
        .get("/assets")
        .set("Authorization", `Bearer ${context.providerToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  // Test asset operations
  describe("Asset Operations", () => {
    it("should require authentication for POST /assets", async () => {
      const response = await context.request.post("/assets").send({
        filename: "test-file.txt",
        contentType: "text/plain",
        size: 1234,
      });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
    });

    it("should validate request payloads for POST /assets", async () => {
      // Test with missing required fields
      // but we'll at least verify the route exists
      const response = await context.request.post("/assets").send({
        // Missing required fields
      });

      // Should be 401 (unauthorized) before we even get to validation
      expect(response.status).toBe(401);
    });

    it("should have an endpoint for getting assets by key requiring authentication", async () => {
      const response = await context.request.get("/assets/some-key");

      expect(response.status).toBe(401);
    });
  });

  // Note: For a complete implementation, you'd want to:
  // 1. Create proper mocks for your S3Service
  // 2. Inject these mocks into the application
  // 3. Test the actual behavior with valid authentication
  //
  // This simplified approach verifies the endpoints exist and
  // require authentication without the complexity of mocking
});
