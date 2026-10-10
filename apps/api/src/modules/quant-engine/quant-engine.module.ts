import { Module } from "@nestjs/common";

import { QuantEngineClient } from "./quant-engine.client";
import { QuantEngineController } from "./quant-engine.controller";

@Module({
  controllers: [QuantEngineController],
  exports: [QuantEngineClient],
  providers: [QuantEngineClient],
})
export class QuantEngineModule {}
