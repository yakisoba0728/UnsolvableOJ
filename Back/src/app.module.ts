import { Module } from '@nestjs/common';
import { VibeModule } from './modules/vibe/vibe.module.js';
import { MissionsModule } from './modules/missions/missions.module.js';
import { CommunityModule } from './modules/community/community.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Redis } from 'ioredis';
import { databaseConnectionOptions } from './config/database.config.js';
import { envValidationSchema } from './config/env.validation.js';
import { redisConnection } from './config/redis.config.js';
import { RedisThrottlerStorage } from './config/redis-throttler.storage.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ProblemsModule } from './modules/problems/problems.module.js';
import { SubmissionsModule } from './modules/submissions/submissions.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { EnterpriseModule } from './modules/enterprise/enterprise.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        ...databaseConnectionOptions(
          config.getOrThrow<string>('DATABASE_URL'),
          config.get<boolean>('DATABASE_SSL', false),
        ),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisConnection(config),
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
        storage: new RedisThrottlerStorage(new Redis(redisConnection(config))),
      }),
    }),
    AuthModule,
    HealthModule,
    ProblemsModule,
    SubmissionsModule,
    AdminModule,
    UsersModule,
    EnterpriseModule,
    CommunityModule,
    MissionsModule,
    NotificationsModule,
    VibeModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
