import {
  ALLOWED_DATABANK_FILE_EXTENSIONS,
  validateDatabankFileType,
} from '../../core/utils/file-validation';

describe('validateDatabankFileType', () => {
  const supportedDjiFiles = [
    'DJI_202602041436_003_Chickpearabi2025A_PPKNAV.nav',
    'DJI_202602041436_003_Chickpearabi2025A_PPKOBS.obs',
    'DJI_202602041436_003_Chickpearabi2025A_PPKRAW.bin',
    'DJI_202602041436_003_Chickpearabi2025A_Timestamp.MRK',
  ];

  it.each(supportedDjiFiles)('allows DJI file %s', (key) => {
    expect(validateDatabankFileType(key)).toEqual({ isValid: true });
  });

  it('exposes each supported extension in normalized form', () => {
    expect(ALLOWED_DATABANK_FILE_EXTENSIONS).toEqual(
      expect.arrayContaining(['.nav', '.obs', '.bin', '.mrk']),
    );
  });

  it('continues to reject unsupported executable files', () => {
    expect(validateDatabankFileType('malware.exe')).toEqual({
      isValid: false,
      reason: 'File type not allowed: .exe',
    });
  });
});
