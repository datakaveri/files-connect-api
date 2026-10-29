import { Request, Response } from 'express';
import axios from 'axios';
import { createAuditMiddleware } from '../../middleware/audit-middleware';
import { AuditContext, AuditService } from '../../services/audit-service';

jest.mock('axios');
jest.mock('../../config/environment', () => ({ env: { CAT_API_URL: 'https://catalogue.example.test' } }));
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('delegation audit context', () => {
  it('retains both identities and exact scopes when publishing a successful action', async () => {
    const publishAuditMessage = jest.fn().mockResolvedValue(undefined);
    const req = {
      method: 'POST', route: { path: '/:databankId/files/delete' }, params: { databankId: 'bank' },
      headers: { authorization: 'Bearer actor-token' }, originalUrl: '/v1/databanks/bank/files/delete',
    } as unknown as Request;
    const res = {
      statusCode: 200, send: jest.fn(), locals: {
        userId: 'owner', userRole: 'provider', isDelegated: true, delegateeId: 'actor',
        delegateeRoles: ['consumer'], scopes: ['own-asset-management'], orgId: 'owner-org',
      },
    } as unknown as Response;
    createAuditMiddleware({ publishAuditMessage })(req, res, jest.fn());
    res.send({ success: true });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(publishAuditMessage).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'owner', orgId: 'owner-org', delegatorId: 'owner', delegatorRole: 'provider',
      context: { delegateeId: 'actor', delegateeRoles: ['consumer'], scopes: ['own-asset-management'] },
    }));
  });

  it('does not fill missing delegator organisation fields from the actor JWT', async () => {
    const publishAuditMessage = jest.fn().mockResolvedValue(undefined);
    mockedAxios.get.mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'application/json' },
      data: { result: [{ ownerUserId: 'owner' }] } });
    const payload = Buffer.from(JSON.stringify({ iss: 'https://idp.example.test', organisation_id: 'actor-org', organisation_name: 'Actor org' })).toString('base64url');
    const context: AuditContext = {
      databankId: 'bank', api: '/v1/databanks/bank/files/delete', method: 'POST', action: 'File Delete',
      userId: 'owner', role: 'provider', delegatorId: 'owner', delegatorRole: 'provider',
      authToken: `Bearer header.${payload}.signature`, context: { delegateeId: 'actor' },
    };
    const service = new AuditService({ publishAuditMessage, close: jest.fn() });
    await service.publishAuditMessage(context);

    const message = publishAuditMessage.mock.calls[0]![0];
    expect(message).toMatchObject({ user_id: 'owner', delegator_id: 'owner', context: { delegateeId: 'actor' } });
    expect(message).not.toHaveProperty('org_id');
    expect(message).not.toHaveProperty('org_name');
    expect(mockedAxios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: context.authToken, DID: 'owner' }),
    }));
  });
});
