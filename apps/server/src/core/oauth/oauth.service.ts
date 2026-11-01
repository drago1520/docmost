import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { z } from 'zod';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { User } from '@docmost/db/types/entity.types';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { JwtOAuthPayload, JwtType } from '../auth/dto/jwt-payload';
import { isUserDisabled } from '../../common/helpers';

const SCOPES = ['read', 'write'];
const CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const random = () => randomBytes(32).toString('base64url');
// a bare JS array would be sent as a postgres array, this stores a json array
const jsonb = (v: unknown) => sql<any>`${JSON.stringify(v)}::text::jsonb`;

// OAuth error bodies are a spec'd shape, so skip Nest's default message format
const oauthError = (error: string, description: string) =>
  new BadRequestException({ error, error_description: description });

const isLocalOrHttps = (u: string) =>
  u.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)/.exec(u) !== null;

const registerSchema = z.object({
  client_name: z.string().min(1).max(200),
  redirect_uris: z
    .array(z.string().url())
    .min(1)
    .refine((uris) => uris.every(isLocalOrHttps), 'redirect_uris must be https or localhost'),
  client_uri: z.string().url().optional(),
  logo_uri: z.string().url().optional(),
});

const authorizeSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().uuid(),
  redirect_uri: z.string().url(),
  state: z.string().optional(),
  scope: z.string().optional(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256'),
});

const tokenSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'),
    code: z.string(),
    client_id: z.string().uuid(),
    redirect_uri: z.string().url(),
    code_verifier: z.string().min(43).max(128),
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string(),
    client_id: z.string().uuid(),
  }),
]);

@Injectable()
export class OAuthService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private userRepo: UserRepo,
    private workspaceRepo: WorkspaceRepo,
    private env: EnvironmentService,
  ) {}

  private appUrl() {
    return this.env.getAppUrl().replace(/\/$/, '');
  }

  authorizationServerMetadata() {
    const base = this.appUrl();
    return {
      issuer: base,
      // the consent page is a client route, the api handles the decision
      authorization_endpoint: `${base}/oauth/consent`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: SCOPES,
    };
  }

  protectedResourceMetadata() {
    const base = this.appUrl();
    return {
      resource: `${base}/mcp`,
      authorization_servers: [base],
      scopes_supported: SCOPES,
      bearer_methods_supported: ['header'],
    };
  }

  async registerClient(body: unknown) {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      throw oauthError('invalid_client_metadata', parsed.error.issues[0].message);
    }
    const dto = parsed.data;
    // self-hosted docmost has one workspace
    const workspace = await this.workspaceRepo.findFirst();
    const client = await this.db
      .insertInto('oauthClients')
      .values({
        name: dto.client_name,
        redirectUris: jsonb(dto.redirect_uris),
        clientUri: dto.client_uri,
        logoUri: dto.logo_uri,
        grantTypes: jsonb(['authorization_code', 'refresh_token']),
        scopes: jsonb(SCOPES),
        tokenEndpointAuthMethod: 'none',
        isDynamic: true,
        workspaceId: workspace.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return {
      client_id: client.id,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPES.join(' '),
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    };
  }

  // Validates the authorize params against the registered client and returns
  // what the consent page needs. Shared by authorize-info and authorize.
  private async checkAuthorizeRequest(params: unknown) {
    const parsed = authorizeSchema.safeParse(params);
    if (!parsed.success) {
      throw oauthError('invalid_request', parsed.error.issues[0].message);
    }
    const p = parsed.data;
    const client = await this.db
      .selectFrom('oauthClients')
      .selectAll()
      .where('id', '=', p.client_id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!client) throw oauthError('invalid_client', 'Unknown client_id');
    if (!(client.redirectUris as string[]).includes(p.redirect_uri)) {
      throw oauthError('invalid_request', 'redirect_uri is not registered');
    }
    const allowed = client.scopes as string[];
    const requested = p.scope ? p.scope.split(' ').filter(Boolean) : allowed;
    const scopes = requested.filter((s) => allowed.includes(s));
    if (scopes.length === 0) {
      throw oauthError('invalid_scope', 'No allowed scope requested');
    }
    return { params: p, client, scopes };
  }

  async authorizeInfo(params: unknown) {
    const { params: p, client, scopes } = await this.checkAuthorizeRequest(params);
    return {
      clientName: client.name,
      redirectUri: p.redirect_uri,
      scopes,
      clientCreatedAt: client.createdAt,
      verified: !client.isDynamic,
    };
  }

  async authorize(
    body: { approved?: boolean; approvedScopes?: string[] } & Record<string, unknown>,
    user: User,
  ): Promise<{ redirectUrl: string }> {
    const { params: p, client, scopes } = await this.checkAuthorizeRequest(body);
    const url = new URL(p.redirect_uri);
    if (p.state) url.searchParams.set('state', p.state);

    if (body.approved !== true) {
      url.searchParams.set('error', 'access_denied');
      return { redirectUrl: url.toString() };
    }

    const granted = (body.approvedScopes ?? scopes).filter((s) => scopes.includes(s));
    if (granted.length === 0) {
      throw oauthError('invalid_scope', 'No scope approved');
    }

    const existing = await this.db
      .selectFrom('oauthGrants')
      .select('id')
      .where('userId', '=', user.id)
      .where('clientId', '=', client.id)
      .where('revokedAt', 'is', null)
      .executeTakeFirst();
    if (existing) {
      await this.db
        .updateTable('oauthGrants')
        .set({ scopes: jsonb(granted), updatedAt: new Date() })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await this.db
        .insertInto('oauthGrants')
        .values({
          userId: user.id,
          clientId: client.id,
          workspaceId: user.workspaceId,
          scopes: jsonb(granted),
        })
        .execute();
    }

    const code = random();
    await this.db
      .insertInto('oauthAuthorizationCodes')
      .values({
        codeHash: sha256(code),
        clientId: client.id,
        userId: user.id,
        workspaceId: user.workspaceId,
        scopes: jsonb(granted),
        redirectUri: p.redirect_uri,
        codeChallenge: p.code_challenge,
        codeChallengeMethod: 'S256',
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      })
      .execute();

    url.searchParams.set('code', code);
    return { redirectUrl: url.toString() };
  }

  async token(body: unknown) {
    const parsed = tokenSchema.safeParse(body);
    if (!parsed.success) {
      throw oauthError('invalid_request', parsed.error.issues[0].message);
    }
    const req = parsed.data;

    if (req.grant_type === 'authorization_code') {
      const code = await this.db
        .selectFrom('oauthAuthorizationCodes')
        .selectAll()
        .where('codeHash', '=', sha256(req.code))
        .executeTakeFirst();
      if (
        !code ||
        code.consumedAt ||
        code.expiresAt < new Date() ||
        code.clientId !== req.client_id ||
        code.redirectUri !== req.redirect_uri
      ) {
        throw oauthError('invalid_grant', 'Authorization code is invalid or expired');
      }
      const challenge = createHash('sha256').update(req.code_verifier).digest('base64url');
      if (challenge !== code.codeChallenge) {
        throw oauthError('invalid_grant', 'PKCE verification failed');
      }
      await this.db
        .updateTable('oauthAuthorizationCodes')
        .set({ consumedAt: new Date() })
        .where('id', '=', code.id)
        .execute();
      const grant = await this.db
        .selectFrom('oauthGrants')
        .select('id')
        .where('userId', '=', code.userId)
        .where('clientId', '=', code.clientId)
        .where('revokedAt', 'is', null)
        .executeTakeFirstOrThrow();
      return this.issueTokens(grant.id, code.userId, code.workspaceId, code.scopes as string[]);
    }

    const old = await this.db
      .selectFrom('oauthTokens')
      .innerJoin('oauthGrants', 'oauthGrants.id', 'oauthTokens.grantId')
      .select([
        'oauthTokens.id',
        'oauthTokens.grantId',
        'oauthTokens.scopes',
        'oauthTokens.workspaceId',
        'oauthTokens.refreshExpiresAt',
        'oauthTokens.revokedAt',
        'oauthGrants.userId',
        'oauthGrants.clientId',
        'oauthGrants.revokedAt as grantRevokedAt',
      ])
      .where('oauthTokens.refreshTokenHash', '=', sha256(req.refresh_token))
      .executeTakeFirst();
    if (
      !old ||
      old.revokedAt ||
      old.grantRevokedAt ||
      old.clientId !== req.client_id ||
      !old.refreshExpiresAt ||
      old.refreshExpiresAt < new Date()
    ) {
      throw oauthError('invalid_grant', 'Refresh token is invalid or expired');
    }
    // rotate: the old refresh token dies with its access token
    await this.db
      .updateTable('oauthTokens')
      .set({ revokedAt: new Date() })
      .where('id', '=', old.id)
      .execute();
    return this.issueTokens(old.grantId, old.userId, old.workspaceId, old.scopes as string[]);
  }

  private async issueTokens(
    grantId: string,
    userId: string,
    workspaceId: string,
    scopes: string[],
  ) {
    const jti = randomUUID();
    const refreshToken = random();
    const payload: JwtOAuthPayload = {
      sub: userId,
      workspaceId,
      grantId,
      scope: scopes.join(' '),
      aud: `${this.appUrl()}/mcp`,
      iss: this.appUrl(),
      jti,
      type: JwtType.OAUTH_ACCESS,
    };
    const accessToken = jwt.sign(payload, this.env.getAppSecret(), {
      expiresIn: ACCESS_TTL_S,
    });
    await this.db
      .insertInto('oauthTokens')
      .values({
        grantId,
        workspaceId,
        accessTokenJti: jti,
        refreshTokenHash: sha256(refreshToken),
        scopes: jsonb(scopes),
        accessExpiresAt: new Date(Date.now() + ACCESS_TTL_S * 1000),
        refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      })
      .execute();
    await this.db
      .updateTable('oauthGrants')
      .set({ lastUsedAt: new Date() })
      .where('id', '=', grantId)
      .execute();
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_S,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    };
  }

  // Called by the jwt strategy for OAUTH_ACCESS tokens once the signature is
  // verified. Returns the request.user shape the guards expect.
  async validateOAuthToken(payload: JwtOAuthPayload) {
    const token = await this.db
      .selectFrom('oauthTokens')
      .innerJoin('oauthGrants', 'oauthGrants.id', 'oauthTokens.grantId')
      .select(['oauthTokens.revokedAt', 'oauthGrants.revokedAt as grantRevokedAt'])
      .where('oauthTokens.accessTokenJti', '=', payload.jti)
      .executeTakeFirst();
    if (!token || token.revokedAt || token.grantRevokedAt) {
      throw new UnauthorizedException('Token revoked');
    }
    const workspace = await this.workspaceRepo.findById(payload.workspaceId);
    const user = await this.userRepo.findById(payload.sub, payload.workspaceId);
    if (!workspace || !user || isUserDisabled(user)) {
      throw new UnauthorizedException();
    }
    return {
      user,
      workspace,
      oauth: { grantId: payload.grantId, scopes: payload.scope.split(' ') },
    };
  }
}
