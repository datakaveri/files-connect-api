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
      userId: 'owner', orgId: 'owner-org', delegatorId: 'owner',
      delegateId: 'actor', actorType: 'DELEGATE',
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
      userId: 'owner', role: 'provider', delegatorId: 'owner',
      delegateId: 'actor', actorType: 'DELEGATE',
      authToken: `Bearer header.${payload}.signature`, context: { delegateeId: 'actor' },
    };
    const service = new AuditService({ publishAuditMessage, close: jest.fn() });
    await service.publishAuditMessage(context);

    const message = publishAuditMessage.mock.calls[0]![0];
    expect(message).toMatchObject({
      user_id: 'owner', delegate_id: 'actor', actor_type: 'DELEGATE',
      context: { delegateeId: 'actor' },
    });
    // The audit table has no delegator columns; sending them makes the consumer reject the row.
    expect(message).not.toHaveProperty('delegator_id');
    expect(message).not.toHaveProperty('delegator_role');
    expect(message).not.toHaveProperty('org_id');
    expect(message).not.toHaveProperty('org_name');
    expect(mockedAxios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: context.authToken, DID: 'owner' }),
    }));
  });

  it('marks a non-delegated request as SELF without a delegate_id', async () => {
    const publishAuditMessage = jest.fn().mockResolvedValue(undefined);
    const req = {
      method: 'POST', route: { path: '/:databankId/files/delete' }, params: { databankId: 'bank' },
      headers: {}, originalUrl: '/v1/databanks/bank/files/delete',
    } as unknown as Request;
    const res = {
      statusCode: 200, send: jest.fn(), locals: { userId: 'owner', userRole: 'provider', isDelegated: false },
    } as unknown as Response;
    createAuditMiddleware({ publishAuditMessage })(req, res, jest.fn());
    res.send({ success: true });
    await new Promise<void>((resolve) => setImmediate(resolve));

    const context = publishAuditMessage.mock.calls[0]![0] as AuditContext;
    expect(context).toMatchObject({ userId: 'owner', actorType: 'SELF' });
    expect(context).not.toHaveProperty('delegateId');

    mockedAxios.get.mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'application/json' }, data: { result: [] } });
    const servicePublish = jest.fn().mockResolvedValue(undefined);
    await new AuditService({ publishAuditMessage: servicePublish, close: jest.fn() }).publishAuditMessage(context);
    const message = servicePublish.mock.calls[0]![0];
    expect(message).toMatchObject({ user_id: 'owner', actor_type: 'SELF' });
    expect(message).not.toHaveProperty('delegate_id');
  });

  it('never publishes delegator fields, even when the token carries an act claim', async () => {
    mockedAxios.get.mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'application/json' }, data: { result: [] } });
    const payload = Buffer.from(JSON.stringify({ iss: 'https://idp.example.test', act: { sub: 'someone', role: 'admin' }, delegator_role: 'admin' })).toString('base64url');
    const publishAuditMessage = jest.fn().mockResolvedValue(undefined);
    await new AuditService({ publishAuditMessage, close: jest.fn() }).publishAuditMessage({
      databankId: 'bank', api: '/v1/databanks/bank/files/download', method: 'POST', action: 'Download',
      userId: 'owner', role: 'provider', authToken: `Bearer header.${payload}.signature`,
    });

    const message = publishAuditMessage.mock.calls[0]![0];
    expect(message).toMatchObject({ user_id: 'owner', actor_type: 'SELF' });
    expect(message).not.toHaveProperty('delegator_id');
    expect(message).not.toHaveProperty('delegator_role');
  });
});
