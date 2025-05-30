/**
 * Jest setup file
 */

// Enable better stack traces for debugging
require("source-map-support").install();
// Load .env.test file
require("dotenv").config({ path: ".env.test" });

// Increase default test timeout
jest.setTimeout(60000); // 60 seconds

// Add global error handlers to catch unhandled rejections and exceptions
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

// Global beforeAll and afterAll hooks
beforeAll(() => {
  console.log("Global test setup");
});

afterAll(() => {
  console.log("Global test teardown");
});

// Mock console methods to reduce noise in test output
const originalConsole = { ...console };

global.console = {
  ...originalConsole,
  log: (...args) => {
    if (process.env.DEBUG === "true") {
      originalConsole.log(...args);
    }
  },
  debug: (...args) => {
    if (process.env.DEBUG === "true") {
      originalConsole.debug(...args);
    }
  },
};
