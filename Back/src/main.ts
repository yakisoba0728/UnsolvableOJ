import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureHttp } from './configure-http.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService);
  configureHttp(app);
  // SIGTERM에 큐 복구 타이머·Redis·DB 연결을 정리하고 종료합니다.
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('UnsolvableOJ API')
    .setDescription('UnsolvableOJ 웹 API 및 채점 요청 API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () =>
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(
    config.get<number>('PORT', 3000),
    config.get<string>('HOST', '127.0.0.1'),
  );
}
await bootstrap();
