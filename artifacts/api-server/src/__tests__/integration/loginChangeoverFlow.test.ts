import { execFileSync } from "child_process";
import { describe, expect, test } from "vitest";

const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const runIntegration = Boolean(testDatabaseUrl);

describe.runIf(runIntegration)("login + changeover integration", () => {
  test("logs in through auth and creates a live changeover session", () => {
    const script = String.raw`
      import request from 'supertest';
      import bcrypt from 'bcryptjs';
      import { randomUUID } from 'crypto';
      import { eq } from 'drizzle-orm';
      import { fileURLToPath as __furl } from 'node:url';
      import { dirname as __dir } from 'node:path';

      // This script is piped to \`tsx -\` (stdin), which loads app.ts as ESM
      // WITHOUT the esbuild banner that the prod build injects — so __dirname
      // (used at app.ts static-root resolution) is undefined here. Mirror the
      // banner before importing the app. (Prod is unaffected: build.mjs defines
      // globalThis.__dirname.)
      globalThis.__filename = __furl(import.meta.url);
      globalThis.__dirname = __dir(globalThis.__filename);

      const { default: app } = await import('./src/app.ts');
      const { db } = await import('@workspace/db');
      const { usersTable, bomsTable, changeoverSessionsTable } = await import('@workspace/db/schema');

      const employeeId = 'EMP' + Date.now();
      const password = 'testpass';
      const hashedPassword = await bcrypt.hash(password, 12);

      const [operator] = await db
        .insert(usersTable)
        .values({
          id: randomUUID(),
          name: 'Integration Operator',
          role: 'operator',
          employee_id: employeeId,
          password_hash: hashedPassword,
          must_change_password: false,
        })
        .returning({ id: usersTable.id });

      const [bom] = await db
        .insert(bomsTable)
        .values({
          name: 'it-login-bom-' + Date.now(),
          description: 'Integration login/changeover BOM',
        })
        .returning({ id: bomsTable.id });

      try {
        const loginRes = await request(app)
          .post('/api/auth/login')
          .set('X-Requested-With', 'XMLHttpRequest')
          .send({ username: employeeId, password, role: 'operator' });

        const authCookie = Array.isArray(loginRes.headers['set-cookie'])
          ? (loginRes.headers['set-cookie'][0] ?? '').split(';')[0]
          : '';

        const meRes = await request(app).get('/api/auth/me').set('Cookie', authCookie);
        const sessionRes = await request(app)
          .post('/api/verification/sessions')
          .set('Cookie', authCookie)
          .set('X-Requested-With', 'XMLHttpRequest')
          .send({ operatorId: operator.id, bomId: bom.id });

        const mineRes = await request(app).get('/api/verification/sessions/mine').set('Cookie', authCookie);

        console.log(JSON.stringify({
          loginStatus: loginRes.status,
          loginBody: loginRes.body,
          meStatus: meRes.status,
          meBody: meRes.body,
          sessionStatus: sessionRes.status,
          sessionBody: sessionRes.body,
          mineStatus: mineRes.status,
          mineBody: mineRes.body,
        }));
      } finally {
        await db.delete(changeoverSessionsTable).where(eq(changeoverSessionsTable.bomId, bom.id));
        await db.delete(bomsTable).where(eq(bomsTable.id, bom.id));
        await db.delete(usersTable).where(eq(usersTable.id, operator.id));
      }
    `;

    const output = execFileSync("pnpm", ["exec", "tsx", "-"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
        DATABASE_URL_TEST: testDatabaseUrl,
        JWT_SECRET: process.env.JWT_SECRET ?? "integration-test-secret-0123456789ABCDEF",
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? "http://localhost:5173",
        LOG_LEVEL: "error",
      },
      input: script,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });

    const jsonLine = output
      .trim()
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.startsWith("{"));

    expect(jsonLine).toBeDefined();

    const result = JSON.parse(jsonLine as string) as {
      loginStatus: number;
      meStatus: number;
      sessionStatus: number;
      mineStatus: number;
      loginBody: { username: string; role: string };
      meBody: { userId: string; username: string; role: string };
      sessionBody: { id: string; operatorId: string; bomId: number; status: string };
      mineBody: {
        data: Array<{ id: string; operatorId: string; bomId: number; status: string }>;
        total: number;
      };
    };

    expect(result.loginStatus).toBe(200);
    expect(result.loginBody).toMatchObject({ role: "operator" });
    expect(result.meStatus).toBe(200);
    expect(result.meBody).toMatchObject({ role: "operator" });
    expect(result.sessionStatus).toBe(201);
    expect(result.sessionBody.id).toMatch(/^SMT_/);
    expect(result.sessionBody.status).toBe("active");
    expect(result.mineStatus).toBe(200);
    // GET /verification/sessions/mine returns a paginated envelope { data, total, ... }.
    expect(result.mineBody.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: result.sessionBody.id,
          status: "active",
        }),
      ]),
    );
  }, 120000);
});

test.skipIf(runIntegration)("requires DATABASE_URL_TEST to run real DB integration tests", () => {
  expect(process.env.DATABASE_URL_TEST).toBeUndefined();
});
