import { createRequire } from "node:module";
import { Client } from "minio";

// Resolve the actual query-string dependency used by MinIO, including pnpm patches.
const minioRequire = createRequire(require.resolve("minio"));
const queryString = minioRequire("query-string") as {
  parse: (query: string) => Record<string, unknown>;
};

describe("MinIO dependency compatibility", () => {
  it("decodes query parameters with the patched URI decoder", () => {
    expect(queryString.parse("name=hello%20world&unicode=%C3%A5"))
      .toEqual({ name: "hello world", unicode: "å" });
  });

  it("preserves malformed escapes while decoding valid UTF-8", () => {
    expect(queryString.parse("value=%C2%61%F0%9F%98%80%GG"))
      .toEqual({ value: "\uFFFDa😀%GG" });
  });

  it("signs download URLs with encoded response headers", async () => {
    const client = new Client({
      endPoint: "storage.example.com",
      region: "us-east-1",
      accessKey: "test-access-key",
      secretKey: "test-secret-key",
    });
    const disposition = 'attachment; filename="a b.csv"';
    const url = new URL(await client.presignedGetObject(
      "test-bucket",
      "folder/a b.csv",
      60,
      { "response-content-disposition": disposition },
      new Date("2026-10-30T00:00:00Z"),
    ));

    expect(url.pathname).toBe("/test-bucket/folder/a%20b.csv");
    expect(url.searchParams.get("response-content-disposition")).toBe(disposition);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
  });
});
