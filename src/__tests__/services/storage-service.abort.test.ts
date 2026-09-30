import { StorageRepositoryInterface } from "../../core/types/storage";
import { StorageService } from "../../services/storage-service";

describe("StorageService.abortMultipartUpload", () => {
  const abortMultipartUpload = jest.fn();
  const repository = {
    abortMultipartUpload,
  } as unknown as StorageRepositoryInterface;
  const service = new StorageService(repository);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it.each(["name", "code", "Code"])(
    "maps NoSuchUpload in %s to 404",
    async (field) => {
      const missingUpload = Object.assign(new Error("The upload does not exist"), {
        [field]: "NoSuchUpload",
      });
      abortMultipartUpload.mockRejectedValueOnce(missingUpload);

      await expect(
        service.abortMultipartUpload("file.csv", "missing-id", "bank-1"),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "RESOURCE_NOT_FOUND",
      });
      expect(abortMultipartUpload).toHaveBeenCalledWith("bank-1/file.csv", "missing-id");
    },
  );

  it("allows a valid upload to be canceled", async () => {
    abortMultipartUpload.mockResolvedValueOnce(undefined);

    await expect(
      service.abortMultipartUpload("file.csv", "active-id", "bank-1"),
    ).resolves.toBeUndefined();
  });

  it("preserves unrelated storage failures", async () => {
    const storageFailure = new Error("Storage unavailable");
    abortMultipartUpload.mockRejectedValueOnce(storageFailure);

    await expect(
      service.abortMultipartUpload("file.csv", "active-id", "bank-1"),
    ).rejects.toBe(storageFailure);
  });
});
