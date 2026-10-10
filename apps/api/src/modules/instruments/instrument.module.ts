import { Module } from "@nestjs/common";

import { InstrumentController } from "./instrument.controller";
import { InstrumentService } from "./instrument.service";

@Module({
  controllers: [InstrumentController],
  exports: [InstrumentService],
  providers: [InstrumentService],
})
export class InstrumentModule {}
