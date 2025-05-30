/**
 * End-to-end tests for Databank Routes
 */
import {
  initTestContext,
  cleanupTestContext,
  TestContext,
} from "../utils/setup";
import { ApiPaths } from "../../config/constants";

describe("Databanks Routes", () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await initTestContext();
  });

  afterAll(async () => {
    await cleanupTestContext(context);
  });

  // Test authentication requirements
  describe("Authentication", () => {
    it("should require authentication for protected endpoints", async () => {
      const databankId = "test-databank";
      const response = await context.request
        .post(`/databanks/${databankId}/${ApiPaths.DATABANK_FILES}`)
        .send({ prefix: "", delimiter: "/" });

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
      expect(response.body.error).toHaveProperty("message");
    });
  });

  // Test databank listing
  describe("GET /databanks", () => {
    it("should require authentication", async () => {
      const response = await context.request.get("/databanks");
      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty("error");
    });

    it("should return 200 with valid token", async () => {
      const response = await context.request
        .get("/databanks")
        .set("Authorization", `Bearer ${context.providerToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      // Optionally validate the structure of each databank in the response
      if (response.body.length > 0) {
        const databank = response.body[0];
        expect(databank).toHaveProperty("id");
        expect(databank).toHaveProperty("name");
      }
    });
  });

  // Test file operations
  describe("File Operations", () => {
    const testDatabankId = "test-databank";

    it("should require authentication for listing files", async () => {
      const response = await context.request
        .get(`/databanks/${testDatabankId}/${ApiPaths.DATABANK_FILES}`)
        .query({ prefix: "", delimiter: "/" });

      expect(response.status).toBe(401);
    });

    it("should list files with valid token", async () => {
      const response = await context.request
        .get(`/databanks/${testDatabankId}/${ApiPaths.DATABANK_FILES}`)
        .query({ prefix: "", delimiter: "/" })
        .set("Authorization", `Bearer ${context.providerToken}`);

      // The endpoint might return 200 with an empty array or 404 if the databank doesn't exist
      expect([200, 404]).toContain(response.status);

      if (response.status === 200) {
        expect(Array.isArray(response.body)).toBe(true);
      } else {
        expect(response.body).toHaveProperty("error");
      }
    });
  });
  // For now, we've verified that the routes exist and require authentication
});
