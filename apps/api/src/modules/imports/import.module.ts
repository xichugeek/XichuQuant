import { Module } from "@nestjs/common";

import { RiskModule } from "../risk/risk.module";
import { ImportController } from "./import.controller";
import { ImportService } from "./import.service";
import { IbkrCsvParserService } from "./parser/ibkr-csv-parser.service";

@Module({
  imports: [RiskModule],
  controllers: [ImportController],
  providers: [ImportService, IbkrCsvParserService],
  exports: [ImportService],
})
export class ImportModule {}
