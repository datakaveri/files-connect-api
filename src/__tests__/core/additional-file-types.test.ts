/**
 * Verifies ADDITIONAL_DATABANK_FILE_TYPES / ADDITIONAL_ASSET_FILE_TYPES append to,
 * rather than replace, the built-in AllowedFileTypes lists.
 */
describe('ADDITIONAL_*_FILE_TYPES env config', () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  it('appends extra extensions to the databank allow-list and still rejects unlisted ones', () => {
    process.env = { ...ORIGINAL_ENV, ADDITIONAL_DATABANK_FILE_TYPES: 'zip, .py' };

    let validateDatabankFileType!: typeof import('../../core/utils/file-validation').validateDatabankFileType;
    jest.isolateModules(() => {
      ({ validateDatabankFileType } = require('../../core/utils/file-validation'));
    });

    expect(validateDatabankFileType('archive.zip')).toEqual({ isValid: true });
    expect(validateDatabankFileType('script.py')).toEqual({ isValid: true });
    expect(validateDatabankFileType('malware.exe')).toEqual({
      isValid: false,
      reason: 'File type not allowed: .exe',
    });
  });

  it('leaves the databank allow-list at its defaults when the env var is unset', () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.ADDITIONAL_DATABANK_FILE_TYPES;

    let validateDatabankFileType!: typeof import('../../core/utils/file-validation').validateDatabankFileType;
    jest.isolateModules(() => {
      ({ validateDatabankFileType } = require('../../core/utils/file-validation'));
    });

    expect(validateDatabankFileType('archive.zip')).toEqual({
      isValid: false,
      reason: 'File type not allowed: .zip',
    });
  });

  it('appends extra extensions to the asset allow-list constant', () => {
    process.env = { ...ORIGINAL_ENV, ADDITIONAL_ASSET_FILE_TYPES: 'zip,py' };

    let AllowedFileTypes!: typeof import('../../config/constants').AllowedFileTypes;
    jest.isolateModules(() => {
      ({ AllowedFileTypes } = require('../../config/constants'));
    });

    expect(AllowedFileTypes.ASSETS).toEqual(expect.arrayContaining(['pdf', 'zip', 'py']));
  });
});
