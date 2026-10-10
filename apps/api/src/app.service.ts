import { Injectable } from "@nestjs/common";

export type ServiceStatus = {
  name: string;
  phase: string;
  status: "ok";
  timestamp: string;
};

@Injectable()
export class AppService {
  getStatus(): ServiceStatus {
    return {
      name: "XichuQuant API",
      phase: "v1.9-external-certification-soak-testing",
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }
}
