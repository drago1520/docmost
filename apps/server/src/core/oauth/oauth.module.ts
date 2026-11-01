import { Module } from '@nestjs/common';
import { OAuthService } from './oauth.service';
import { OAuthController, OAuthWellKnownController } from './oauth.controller';

@Module({
  controllers: [OAuthController, OAuthWellKnownController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
