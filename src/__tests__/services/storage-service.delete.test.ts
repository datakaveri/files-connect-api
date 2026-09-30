import { StorageRepositoryInterface } from "../../core/types/storage";
import { StorageService } from "../../services/storage-service";

describe("StorageService.deleteObject", () => {
  const headObject = jest.fn();
  const deleteObject = jest.fn();
  const repository = {
    headObject,
    deleteObject,
  } as unknown as StorageRepositoryInterface;
  const service = new StorageService(repository);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 and does not delete when the file is missing", async () => {
    headObject.mockResolvedValue(null);

    await expect(service.deleteObject("missing.csv", "bank-1")).rejects.toMatchObject({
      statusCode: 404,
      code: "RESOURCE_NOT_FOUND",
    });
    expect(headObject).toHaveBeenCalledWith("bank-1/missing.csv");
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("deletes a file that exists", async () => {
    headObject.mockResolvedValue({ ContentLength: 0 });
    deleteObject.mockResolvedValue(undefined);

    await expect(service.deleteObject("file.csv", "bank-1")).resolves.toBeUndefined();
    expect(headObject).toHaveBeenCalledWith("bank-1/file.csv");
    expect(deleteObject).toHaveBeenCalledWith("bank-1/file.csv");
  });
});
