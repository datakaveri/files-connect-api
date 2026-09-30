import { StorageRepositoryInterface } from "../../core/types/storage";
import { StorageService } from "../../services/storage-service";

describe("StorageService.completeMultipartUpload", () => {
  const completeMultipartUpload = jest.fn();
  const repository = {
    completeMultipartUpload,
  } as unknown as StorageRepositoryInterface;
  const service = new StorageService(repository);
  const parts = [{ PartNumber: 1, ETag: "etag-from-uploaded-part" }];

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it.each(["name", "code", "Code"])(
    "maps NoSuchUpload in %s to 404",
    async (field) => {
      const missingUpload = Object.assign(new Error("The upload does not exist"), {
        [field]: "NoSuchUpload",
      });
      completeMultipartUpload.mockRejectedValueOnce(missingUpload);

      await expect(
        service.completeMultipartUpload("file.csv", "missing-id", "bank-1", parts),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "RESOURCE_NOT_FOUND",
      });
      expect(completeMultipartUpload).toHaveBeenCalledWith(
        "bank-1/file.csv",
        "missing-id",
        parts,
      );
    },
  );

  it("completes an active upload with its supplied parts", async () => {
    completeMultipartUpload.mockResolvedValueOnce({});

    await expect(
      service.completeMultipartUpload("file.csv", "active-id", "bank-1", parts),
    ).resolves.toBe("bank-1/file.csv");
    expect(completeMultipartUpload).toHaveBeenCalledWith(
      "bank-1/file.csv",
      "active-id",
      parts,
    );
  });

  it("preserves unrelated storage failures", async () => {
    const storageFailure = new Error("Storage unavailable");
    completeMultipartUpload.mockRejectedValueOnce(storageFailure);

    await expect(
      service.completeMultipartUpload("file.csv", "active-id", "bank-1", parts),
    ).rejects.toBe(storageFailure);
  });
});
