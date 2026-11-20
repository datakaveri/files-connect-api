import express from 'express';
import cors from 'cors';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Readable } from 'stream';
import { generateKeyPairSync } from 'crypto';
import { env } from '../../config/environment';
import { initPublicAssetRoutes, buildPublicAssetKey } from '../../routes/public-assets-routes';
import { initAssetRoutes } from '../../routes/assets-routes';
import { StorageServiceInterface } from '../../services/storage-service';
import { errorHandler } from '../../middleware/error-handler';

jest.mock('axios');
jest.mock('../../services/delegation-resolver', () => ({ resolveDelegation: jest.fn() }));
jest.mock('../../config/environment', () => ({ env: {
  AUTH_ENABLED: true, AUTHZ_ENABLED: true, KEYCLOAK_PUBLIC_KEY: '',
  ADDITIONAL_ASSET_FILE_TYPES: [], ADDITIONAL_DATABANK_FILE_TYPES: [],
  CAT_API_URL: 'https://catalogue.example.test', ACL_APD_API_URL: 'https://acl.example.test',
} }));

const owner = '19c93458-bb92-48e8-87b5-635f269373b7';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });

const storage = {
  getAssetDetails: jest.fn(),
  getAsset: jest.fn(),
  uploadAsset: jest.fn(),
  createAssetPresignedUrl: jest.fn(),
};

const app = express();
// Mirror app.ts: a credentialed CORS policy for a configured origin is applied globally
app.use(cors({ origin: 'https://ui.example.test', credentials: true }));
app.use(express.json());
app.use('/assets', initAssetRoutes(storage as unknown as StorageServiceInterface));
app.use('/public_assets', initPublicAssetRoutes(storage as unknown as StorageServiceInterface));
app.use(errorHandler);

function token(roles = ['provider'], sub = owner) {
  return jwt.sign({ sub, realm_access: { roles } }, keys.privateKey, { algorithm: 'RS256', expiresIn: '1h' });
}

describe('public asset routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    env.KEYCLOAK_PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    storage.getAssetDetails.mockResolvedValue({
      key: 'k', size: 10, contentType: 'image/png', lastModified: new Date('2026-01-01T00:00:00Z'), isFile: true,
    });
    storage.getAsset.mockImplementation(async () => Readable.from([Buffer.from('test-image')]));
    storage.uploadAsset.mockImplementation(async (key: string) => key);
  });

  describe('GET /public_assets/:userId/:filename', () => {
    it('serves a public asset without an Authorization header', async () => {
      const response = await request(app).get(`/public_assets/${owner}/logo.png`).set('Origin', 'https://bodh.tanuh.ai');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toContain('sandbox');
      expect(response.body.toString()).toBe('test-image');
      expect(storage.getAssetDetails).toHaveBeenCalledWith(`public_assets/${owner}/logo.png`);
      expect(storage.getAsset).toHaveBeenCalledWith(`public_assets/${owner}/logo.png`);
    });

    it('returns 404 when the public asset does not exist', async () => {
      storage.getAssetDetails.mockResolvedValueOnce(null);
      const response = await request(app).get(`/public_assets/${owner}/missing.png`);

      expect(response.status).toBe(404);
      expect(storage.getAsset).not.toHaveBeenCalled();
    });

    it.each([
      ['encoded slash traversal', `/public_assets/${owner}/..%2F..%2Fassets%2F${owner}%2Fsecret.png`],
      ['encoded backslash', `/public_assets/${owner}/..%5Csecret.png`],
      ['dot-dot filename', `/public_assets/${owner}/..`],
      ['traversal in owner segment', `/public_assets/..%2Fassets/secret.png`],
      ['control character', `/public_assets/${owner}/a%00b.png`],
    ])('rejects %s without touching storage', async (_name, path) => {
      const response = await request(app).get(path);

      expect([400, 404]).toContain(response.status);
      expect(storage.getAssetDetails).not.toHaveBeenCalled();
      expect(storage.getAsset).not.toHaveBeenCalled();
    });

    it('cannot reach private assets: keys are always under public_assets/', () => {
      expect(buildPublicAssetKey(owner, 'file.png')).toBe(`public_assets/${owner}/file.png`);
      expect(() => buildPublicAssetKey(owner, '../file.png')).toThrow();
      expect(() => buildPublicAssetKey('../assets', 'file.png')).toThrow();
    });

    it('does not expose a listing endpoint', async () => {
      const listing = await request(app).get(`/public_assets/${owner}`);
      expect(listing.status).toBe(404);
      expect(storage.getAssetDetails).not.toHaveBeenCalled();
    });
  });

  describe('POST /public_assets', () => {
    it('requires authentication', async () => {
      const response = await request(app).post('/public_assets')
        .attach('file', Buffer.from('test-image'), { filename: 'image.png', contentType: 'image/png' });

      expect(response.status).toBe(401);
      expect(storage.uploadAsset).not.toHaveBeenCalled();
    });

    it('stores the upload under public_assets/{userId}/', async () => {
      const response = await request(app).post('/public_assets').auth(token(), { type: 'bearer' })
        .attach('file', Buffer.from('test-image'), { filename: 'image.png', contentType: 'image/png' });

      expect(response.status).toBe(201);
      expect(storage.uploadAsset).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^public_assets/${owner}/\\d+-[0-9a-f-]{36}-image\\.png$`)),
        expect.any(Buffer),
        'image/png'
      );
      expect(response.body.data.key).toMatch(new RegExp(`^${owner}/`));
    });

    it('rejects disallowed file types', async () => {
      const response = await request(app).post('/public_assets').auth(token(), { type: 'bearer' })
        .attach('file', Buffer.from('<html></html>'), { filename: 'page.html', contentType: 'text/html' });

      expect(response.status).toBe(415);
      expect(storage.uploadAsset).not.toHaveBeenCalled();
    });
  });

  describe('POST /assets (unchanged)', () => {
    it('still stores private uploads under assets/{userId}/', async () => {
      const response = await request(app).post('/assets').auth(token(), { type: 'bearer' })
        .attach('file', Buffer.from('test-image'), { filename: 'image.png', contentType: 'image/png' });

      expect(response.status).toBe(201);
      expect(storage.uploadAsset).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^assets/${owner}/`)), expect.any(Buffer), 'image/png'
      );
    });
  });
});
