import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { OAuthService } from './oauth.service';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User } from '@docmost/db/types/entity.types';

// Discovery documents live at the root, outside the /api prefix (see main.ts).
@Controller('.well-known')
export class OAuthWellKnownController {
  constructor(private oauthService: OAuthService) {}

  @SkipTransform()
  @Get('oauth-authorization-server')
  authorizationServer() {
    return this.oauthService.authorizationServerMetadata();
  }

  @SkipTransform()
  @Get(['oauth-protected-resource', 'oauth-protected-resource/mcp'])
  protectedResource() {
    return this.oauthService.protectedResourceMetadata();
  }
}

@Controller('oauth')
export class OAuthController {
  constructor(private oauthService: OAuthService) {}

  // Bodies are untyped on purpose: the global ValidationPipe would strip the
  // raw OAuth params, so the service validates them with zod instead.
  @SkipTransform()
  @Post('register')
  register(@Body() body: Record<string, unknown>) {
    return this.oauthService.registerClient(body);
  }

  @SkipTransform()
  @Post('token')
  token(@Body() body: Record<string, unknown>) {
    return this.oauthService.token(body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('authorize-info')
  authorizeInfo(@Body() body: Record<string, unknown>) {
    return this.oauthService.authorizeInfo(body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('authorize')
  authorize(@Body() body: Record<string, unknown>, @AuthUser() user: User) {
    return this.oauthService.authorize(body, user);
  }
}
