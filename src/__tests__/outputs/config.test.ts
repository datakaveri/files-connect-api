import { resolveExistingOutputCredentials } from '../../outputs/config';

describe('output storage credential selection', () => {
  test('uses the existing STORAGE credential pair in demo mode', () => {
    expect(resolveExistingOutputCredentials({
      useExistingCredentials: true,
      storageAccessKey: 'storage-access',
      storageSecretKey: 'storage-secret',
      s3AccessKey: 'legacy-access',
      s3SecretKey: 'legacy-secret',
    })).toEqual({ accessKeyId: 'storage-access', secretAccessKey: 'storage-secret' });
  });

  test('falls back to the legacy S3 credential pair', () => {
    expect(resolveExistingOutputCredentials({
      useExistingCredentials: true,
      s3AccessKey: 'legacy-access',
      s3SecretKey: 'legacy-secret',
    })).toEqual({ accessKeyId: 'legacy-access', secretAccessKey: 'legacy-secret' });
  });

  test('does not select static credentials when demo mode is disabled', () => {
    expect(resolveExistingOutputCredentials({
      useExistingCredentials: false,
      s3AccessKey: 'legacy-access',
      s3SecretKey: 'legacy-secret',
    })).toBeUndefined();
  });

  test('rejects an incomplete existing credential pair', () => {
    expect(() => resolveExistingOutputCredentials({
      useExistingCredentials: true,
      s3AccessKey: 'legacy-access',
    })).toThrow('OUTPUT_STORAGE_USE_EXISTING_CREDENTIALS requires');
  });
});
