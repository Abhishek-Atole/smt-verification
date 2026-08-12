declare module "@prisma/client" {
  export const UserRole: {
    operator: "operator";
    qa: "qa";
    engineer: "engineer";
    admin: "admin";
  };

  export class PrismaClient {
    user: any;
    bomHeader: any;
    bomLineItem: any;
    bomAlternative: any;
    changeover: any;
    verificationScan: any;
    spliceRecord: any;
    auditLog: any;
    $disconnect(): Promise<void>;
    constructor(options?: unknown);
  }
}