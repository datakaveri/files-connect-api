import { NextFunction, Request, Response } from 'express';
import axios from 'axios';
import { checkItemAccess, checkItemAccessWithDatabankAccess, checkIsOwner } from '../../middleware/auth';

jest.mock('axios');
jest.mock('../../config/environment', () => ({
  env: {
    AUTH_ENABLED: true,
    AUTHZ_ENABLED: true,
    ACL_APD_API_URL: 'https://acl.example.test',
    CAT_API_URL: 'https://catalogue.example.test',
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createRequest(): Request {
  return {
    params: { databankId: 'databank-1' },
    query: {},
    body: {},
    headers: { authorization: 'Bearer test-token' },
    header: jest.fn((name: string) =>
      name.toLowerCase() === 'authorization' ? 'Bearer test-token' : undefined
    ),
  } as unknown as Request;
}

function createResponse(): Response {
  return {
    locals: {
      userId: 'user-1',
      databankId: 'user-databank',
    },
  } as unknown as Response;
}

describe('checkItemAccessWithDatabankAccess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['file listing', checkItemAccess],
    ['databank download', checkItemAccessWithDatabankAccess],
    ['owner-only routes', checkIsOwner],
  ])('returns 404 when Catalogue cannot find the databank for %s', async (_route, middleware) => {
    mockedAxios.isAxiosError.mockReturnValueOnce(true);
    mockedAxios.get.mockRejectedValueOnce({
      response: { status: 404, statusText: 'Not Found' },
    });

    const next = jest.fn() as NextFunction;
    await middleware(createRequest(), createResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 404,
      code: 'RESOURCE_NOT_FOUND',
    }));
  });

  it('keeps a Catalogue server failure as 503', async () => {
    mockedAxios.isAxiosError.mockReturnValueOnce(true);
    mockedAxios.get.mockRejectedValueOnce({
      response: { status: 500, statusText: 'Internal Server Error' },
    });

    const next = jest.fn() as NextFunction;
    await checkItemAccessWithDatabankAccess(createRequest(), createResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 503,
    }));
  });

  it('handles a returned Catalogue 404 as databank not found', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 404,
      headers: { 'content-type': 'application/json' },
      data: {},
    });

    const next = jest.fn() as NextFunction;
    await checkItemAccessWithDatabankAccess(createRequest(), createResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 404,
      code: 'RESOURCE_NOT_FOUND',
    }));
  });

  it('bypasses ACL/APD only when catalogue accessPolicy is OPEN', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        result: [{ accessPolicy: 'OPEN' }],
      },
    });

    const next = jest.fn() as NextFunction;

    await checkItemAccessWithDatabankAccess(createRequest(), createResponse(), next);

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://catalogue.example.test/item?id=databank-1&auditEnabled=false',
      { headers: { Authorization: 'Bearer test-token' } }
    );
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('checks ACL/APD when catalogue accessPolicy is PRIVATE', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        result: [{ accessPolicy: 'PRIVATE' }],
      },
    });
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        type: 'urn:dx:apdServerPanel:success',
      },
    });

    const next = jest.fn() as NextFunction;

    await checkItemAccessWithDatabankAccess(createRequest(), createResponse(), next);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://acl.example.test/access_request/has_access',
      { itemId: 'databank-1' },
      { headers: { Authorization: 'Bearer test-token' } }
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows ACL/APD v2 success when policies have no constraints', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        result: [{ accessPolicy: 'PRIVATE' }],
      },
    });
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        type: 'dx:aclApd:success',
        result: {
          policies: [{ policyId: 'policy-1', status: 'ACTIVE' }],
        },
      },
    });

    const next = jest.fn() as NextFunction;

    await checkItemAccessWithDatabankAccess(createRequest(), createResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows ACL/APD v2 success when constrained policy includes file access', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        result: [{ accessPolicy: 'PRIVATE' }],
      },
    });
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        type: 'dx:aclApd:success',
        result: {
          policies: [
            {
              policyId: 'policy-1',
              status: 'ACTIVE',
              constraints: {
                access: [{ accessType: 'file' }],
              },
            },
          ],
        },
      },
    });

    const next = jest.fn() as NextFunction;

    await checkItemAccessWithDatabankAccess(createRequest(), createResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('allows legacy ACL/APD success detail when response type is unrecognized', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        result: [{ accessPolicy: 'PRIVATE' }],
      },
    });
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        type: 'urn:dx:aclServer:success',
        detail: 'User has access to the given asset!',
      },
    });

    const next = jest.fn() as NextFunction;

    await checkItemAccessWithDatabankAccess(createRequest(), createResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('denies ACL/APD v2 success when constraints omit file access', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        result: [{ accessPolicy: 'PRIVATE' }],
      },
    });
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        type: 'dx:aclApd:success',
        result: {
          policies: [
            {
              policyId: 'policy-1',
              status: 'ACTIVE',
              constraints: {
                access: [{ accessType: 'api' }],
                subjects: {
                  allowedRoles: ['provider'],
                },
              },
            },
          ],
        },
      },
    });

    const next = jest.fn() as NextFunction;

    await checkItemAccessWithDatabankAccess(createRequest(), createResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: 'File access is not permitted for this databank',
    }));
  });
});
