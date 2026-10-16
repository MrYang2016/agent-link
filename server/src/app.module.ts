import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiExceptionFilter } from './api-exception.filter';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { BearerAuthGuard } from './auth/guards/bearer-auth.guard';
import { SessionOrBearerGuard } from './auth/guards/session-or-bearer.guard';
import { WebSessionGuard } from './auth/guards/web-session.guard';
import { ChannelController } from './channels/channels.controller';
import { ChannelService } from './channels/channels.service';
import { CompanySeed } from './company-seed.service';
import { entities, typeOrmOptions } from './database.options';
import { EventHub } from './events/event-hub';
import { EventsController } from './events/events.controller';
import { InstallController } from './install/install.controller';
import { createValidationPipe } from './validation.pipe';

@Module({
  imports: [TypeOrmModule.forRoot(typeOrmOptions()), TypeOrmModule.forFeature(entities)],
  controllers: [AuthController, ChannelController, InstallController, EventsController],
  providers: [
    AuthService,
    ChannelService,
    EventHub,
    CompanySeed,
    WebSessionGuard,
    BearerAuthGuard,
    SessionOrBearerGuard,
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_PIPE, useFactory: () => createValidationPipe() },
  ],
})
export class AppModule {}
