import { Module } from "@nestjs/common";

import { BrokerPaperModule } from "../broker-execution/broker-paper.module";
import { CertificationController } from "./certification.controller";
import { CertificationService } from "./certification.service";

@Module({ controllers: [CertificationController], imports: [BrokerPaperModule], providers: [CertificationService] })
export class CertificationModule {}
