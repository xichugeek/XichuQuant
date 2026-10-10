import "./common/isolated-environment";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module";
import { assertPublicDemoConfiguration, assertPublicDemoDatabase } from "./common/deployment-safety";
import { PrismaService } from "./prisma/prisma.service";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  assertPublicDemoConfiguration(process.env);
  if (process.env.PUBLIC_DEMO_READ_ONLY === "true") await assertPublicDemoDatabase(app.get(PrismaService));

  app.useLogger(app.get(Logger));
  app.useBodyParser("json", { limit: "20mb" });
  app.enableShutdownHooks();
  app.enableCors({
    credentials: true,
    origin: config
      .get<string>("WEB_ORIGIN", "http://localhost:5088")
      .split(",")
      .map((item) => item.trim()),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );

  const port = config.get<number>("API_PORT", 5089);
  await app.listen(port, config.get<string>("API_HOST", "127.0.0.1"));
}

void bootstrap();
