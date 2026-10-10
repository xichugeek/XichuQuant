import { Controller, Get } from "@nestjs/common";

import { QuantEngineClient } from "./quant-engine.client";

@Controller("quant-engine")
export class QuantEngineController {
  constructor(private readonly client: QuantEngineClient) {}

  @Get("health")
  health() {
    return this.client.health();
  }

  @Get("version")
  version() {
    return this.client.version();
  }
}
