import express, { Request, Response } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'crypto';
import axios from 'axios';
import { env } from '../../config/environment';
import { authenticate, authorize, checkIsOwner, checkItemAccess, checkItemAccessWithDatabankAccess } from '../../middleware/auth';
import { resolveDelegation } from '../../services/delegation-resolver';
import { AuthorizationError, ServiceUnavailableError } from '../../core/errors';
import { UserRole } from '../../core/types/auth';
import { DelegationScope } from '../../core/types/delegation';
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

const mockedResolve = jest.mocked(resolveDelegation);
const mockedAxios = axios as jest.Mocked<typeof axios>;
const actor = 'ff14ea1d-6539-4271-9e08-3e1a57b47bd6';
const owner = '19c93458-bb92-48e8-87b5-635f269373b7';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const app = express();
app.use(express.json());
const assetStorage = {
  getAssetDetails: jest.fn(), createAssetPresignedUrl: jest.fn(), uploadAsset: jest.fn(),
};

function sendContext(_req: Request, res: Response) {
  res.json({ userId: res.locals.userId, roles: res.locals.userRoles, scopes: res.locals.scopes,
    orgId: res.locals.orgId, delegateeId: res.locals.delegateeId,
    delegateeRoles: res.locals.delegateeRoles, isDelegated: res.locals.isDelegated });
}

app.get('/databanks/:databankId/context', authenticate, sendContext);
app.post('/databanks/:databankId/uploads', authenticate,
  authorize([UserRole.PROVIDER], [DelegationScope.OWN_ASSET_MANAGEMENT]), checkIsOwner, sendContext);
app.post('/databanks/:databankId/files/delete', authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER], [DelegationScope.OWN_ASSET_MANAGEMENT]), checkIsOwner, sendContext);
app.get('/databanks/:databankId/read', authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER], [DelegationScope.DATA_ACCESS]), checkItemAccessWithDatabankAccess, sendContext);
app.get('/databanks/:databankId/list', authenticate,
  authorize([UserRole.PROVIDER, UserRole.CONSUMER], [DelegationScope.DATA_ACCESS]), checkItemAccess, sendContext);
app.get('/databanks/:databankId/unmapped', authenticate, authorize([UserRole.PROVIDER]), sendContext);
app.get('/assets/admin', authenticate, authorize([UserRole.ADMIN]), sendContext);
app.get('/databanks/:databankId/fallback', authorize([UserRole.PROVIDER], [DelegationScope.DATA_ACCESS]), sendContext);
app.use('/assets', initAssetRoutes(assetStorage as unknown as StorageServiceInterface));
app.use(errorHandler);

function token(roles = ['provider', 'cos_admin'], sub: string | undefined = actor) {
  return jwt.sign({ ...(sub && { sub }), realm_access: { roles }, organisation_id: 'actor-org' },
    keys.privateKey, { algorithm: 'RS256', expiresIn: '1h' });
}
function catalogueResponse(provider = owner) {
  return { status: 200, headers: { 'content-type': 'application/json' },
    data: { result: [{ ownerUserId: provider, accessPolicy: 'PRIVATE' }] } };
}

describe('delegated authentication and scope enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.get.mockReset();
    mockedAxios.post.mockReset();
    assetStorage.getAssetDetails.mockResolvedValue({ size: 10 });
    assetStorage.createAssetPresignedUrl.mockResolvedValue('https://storage.example.test/file');
    env.KEYCLOAK_PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    mockedResolve.mockReset().mockResolvedValue({
      userId: owner, delegateeId: actor, roles: ['consumer'], scopes: ['data-access'],
      orgId: 'owner-org', orgName: 'Owner organisation',
    });
  });

  it('keeps ordinary JWT authentication unchanged and makes no delegation call', async () => {
    const response = await request(app).get('/databanks/bank/context').auth(token(), { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ userId: actor, orgId: 'actor-org', roles: ['provider', 'cos_admin'], isDelegated: false });
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it('replaces identity, organisation and permissions while retaining the authenticated actor', async () => {
    const response = await request(app).get('/databanks/bank/context').auth(token(), { type: 'bearer' }).set('DID', owner);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: owner, orgId: 'owner-org', roles: ['consumer'],
      scopes: ['data-access'], delegateeId: actor, delegateeRoles: ['provider', 'cos_admin'], isDelegated: true });
    expect(mockedResolve).toHaveBeenCalledWith(owner, actor);
  });

  it('rejects an invalid JWT before consulting delegation', async () => {
    const response = await request(app).get('/databanks/bank/context').auth('invalid-token', { type: 'bearer' }).set('DID', owner);
    expect(response.status).toBe(401);
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it('rejects a signed token without a subject before consulting delegation', async () => {
    const noSubject = jwt.sign({ realm_access: { roles: ['provider'] } }, keys.privateKey, { algorithm: 'RS256' });
    const response = await request(app).get('/databanks/bank/context').auth(noSubject, { type: 'bearer' }).set('DID', owner);
    expect(response.status).toBe(401);
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it.each(['', 'not-a-uuid', `${owner}, ${actor}`])('rejects malformed DID %j', async (did) => {
    const response = await request(app).get('/databanks/bank/context').auth(token(), { type: 'bearer' }).set('DID', did);
    expect(response.status).toBe(400);
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it.each([
    [new AuthorizationError('No active delegation'), 403],
    [new ServiceUnavailableError('Delegation'), 503],
  ])('preserves a delegation failure as its original HTTP status', async (error, expectedStatus) => {
    mockedResolve.mockRejectedValueOnce(error);
    const response = await request(app).get('/databanks/bank/context').auth(token(), { type: 'bearer' }).set('DID', owner);
    expect(response.status).toBe(expectedStatus);
    if (expectedStatus === 503) expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it.each(['uploads', 'files/delete'])('denies read-only delegation on %s despite provider/admin JWT and response roles', async (path) => {
    mockedResolve.mockResolvedValueOnce({ userId: owner, delegateeId: actor,
      roles: ['provider', 'cos_admin'], scopes: ['data-access'] });
    const response = await request(app).post(`/databanks/bank/${path}`).auth(token(), { type: 'bearer' }).set('DID', owner);
    expect(response.status).toBe(403);
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('allows an owner-management scope without requiring a provider role', async () => {
    mockedResolve.mockResolvedValueOnce({ userId: owner, delegateeId: actor, roles: [], scopes: ['own-asset-management'] });
    mockedAxios.get.mockResolvedValueOnce(catalogueResponse());
    const login = token(['consumer']);
    const response = await request(app).post('/databanks/bank/uploads').auth(login, { type: 'bearer' }).set('DID', owner);
    expect(response.status).toBe(200);
    expect(mockedAxios.get).toHaveBeenCalledWith(expect.any(String), {
      headers: { Authorization: `Bearer ${login}`, DID: owner },
    });
    expect(mockedResolve).toHaveBeenCalledTimes(1);
  });

  it('denies management if the actor owns the databank but the delegator does not', async () => {
    mockedResolve.mockResolvedValueOnce({ userId: owner, delegateeId: actor, roles: ['cos_admin'], scopes: ['own-asset-management'] });
    mockedAxios.get.mockResolvedValueOnce(catalogueResponse(actor));
    const response = await request(app).post('/databanks/bank/uploads').auth(token(), { type: 'bearer' }).set('DID', owner);
    expect(response.status).toBe(403);
  });

  it('forwards delegated context to Catalogue and ACL for reads', async () => {
    mockedAxios.get.mockResolvedValueOnce(catalogueResponse());
    mockedAxios.post.mockResolvedValueOnce({ headers: { 'content-type': 'application/json' },
      data: { type: 'dx:aclApd:success' } });
    const login = token();
    const response = await request(app).get('/databanks/bank/read').auth(login, { type: 'bearer' }).set('DID', owner);
    expect(response.status).toBe(200);
    const expected = { headers: { Authorization: `Bearer ${login}`, DID: owner } };
    expect(mockedAxios.get).toHaveBeenCalledWith(expect.any(String), expected);
    expect(mockedAxios.post).toHaveBeenCalledWith(expect.any(String), { itemId: 'bank' }, expected);
  });

  it('checks delegated ACL access for a non-public listing', async () => {
    mockedAxios.get.mockResolvedValueOnce(catalogueResponse());
    mockedAxios.post.mockResolvedValueOnce({ headers: { 'content-type': 'application/json' },
      data: { type: 'dx:aclApd:success' } });
    const response = await request(app).get('/databanks/bank/list').auth(token(), { type: 'bearer' }).set('DID', owner);
    expect(response.status).toBe(200);
    expect(mockedAxios.post).toHaveBeenCalledWith(expect.any(String), { itemId: 'bank' },
      expect.objectContaining({ headers: expect.objectContaining({ DID: owner }) }));
  });

  it.each([{ scopes: [] }, { scopes: ['own-asset-management'] }])('denies reads without data-access, including on OPEN databanks (%j)', async ({ scopes }) => {
    mockedResolve.mockResolvedValueOnce({ userId: owner, delegateeId: actor, roles: ['provider'], scopes });
    const response = await request(app).get('/databanks/bank/read').auth(token(), { type: 'bearer' }).set('DID', owner);
    expect(response.status).toBe(403);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('denies delegation at a route with no explicit scope mapping', async () => {
    const response = await request(app).get('/databanks/bank/unmapped').auth(token(), { type: 'bearer' }).set('DID', owner);
    expect(response.status).toBe(403);
  });

  it('can authenticate from authorize without using stale role flags', async () => {
    const response = await request(app).get('/databanks/bank/fallback').auth(token(['provider']), { type: 'bearer' });
    expect(response.status).toBe(200);
  });

  it('does not grant an admin role merely because a route allows admins', async () => {
    const response = await request(app).get('/assets/admin').auth(token(['consumer']), { type: 'bearer' });
    expect(response.status).toBe(403);
  });

  it('does not use a returned admin role to bypass asset ownership', async () => {
    mockedResolve.mockResolvedValueOnce({ userId: owner, delegateeId: actor, roles: ['cos_admin'], scopes: ['data-access'] });
    const response = await request(app).post('/assets/download').auth(token(), { type: 'bearer' })
      .set('DID', owner).send({ key: `${actor}/file.png` });
    expect(response.status).toBe(403);
    expect(assetStorage.getAssetDetails).not.toHaveBeenCalled();
  });

  it('uses the delegator namespace for asset downloads', async () => {
    const response = await request(app).post('/assets/download').auth(token(), { type: 'bearer' })
      .set('DID', owner).send({ key: `${owner}/file.png` });
    expect(response.status).toBe(200);
    expect(assetStorage.getAssetDetails).toHaveBeenCalledWith(`assets/${owner}/file.png`);
  });

  it('uses the delegator namespace for asset uploads', async () => {
    mockedResolve.mockResolvedValueOnce({ userId: owner, delegateeId: actor, roles: [], scopes: ['own-asset-management'] });
    const response = await request(app).post('/assets').auth(token(), { type: 'bearer' }).set('DID', owner)
      .attach('file', Buffer.from('test-image'), { filename: 'image.png', contentType: 'image/png' });
    expect(response.status).toBe(201);
    expect(assetStorage.uploadAsset).toHaveBeenCalledWith(expect.stringContaining(`assets/${owner}/`), expect.any(Buffer), 'image/png');
  });
});
