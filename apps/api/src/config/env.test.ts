import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./env.js";

const APP_PASSWORD = "test-only-app-password-long-enough";
const validUrl = `postgresql://lexora_app:${APP_PASSWORD}@db:5432/lexora`;

// A real-looking key is not needed: any 32 bytes, base64-encoded.
const TEST_KEY = Buffer.alloc(32, 1).toString("base64");

/** Required settings other than the database. */
const required = {
  APP_ORIGIN: "http://127.0.0.1:5173",
  MFA_ENCRYPTION_KEY: TEST_KEY,
};
const productionRequired = { ...required, APP_ORIGIN: "https://lexora.office.example" };

const base = {
  NODE_ENV: "development",
  DATABASE_URL: validUrl,
  ...required,
};

function problemsFor(env: Record<string, string | undefined>, readFile?: (p: string) => string) {
  try {
    loadConfig(env, readFile);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

describe("loadConfig", () => {
  it("accepts a minimal valid configuration and applies safe defaults", () => {
    const config = loadConfig(base);
    expect(config).toEqual({
      nodeEnv: "development",
      isProduction: false,
      host: "127.0.0.1",
      port: 3000,
      logLevel: "info",
      databaseUrl: validUrl,
      databasePoolMax: 10,
      trustProxy: 0,
      appOrigin: "http://127.0.0.1:5173",
      mfaEncryptionKey: Buffer.alloc(32, 1),
      mfaEncryptionKeyPrevious: null,
      sessionIdleMs: 30 * 60_000,
      sessionAbsoluteMs: 10 * 3_600_000,
      argon2: { memoryKib: 65_536, iterations: 3 },
    });
  });

  it("reports every missing required setting", () => {
    const problems = problemsFor({});
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^NODE_ENV: /),
        expect.stringMatching(/^DATABASE_URL: is required/),
      ]),
    );
  });

  it.each([
    ["postgres", "superuser"],
    ["lexora_owner", "owner role"],
  ])("refuses to run as the %s role", (user) => {
    const problems = problemsFor({
      ...base,
      DATABASE_URL: `postgresql://${user}:${APP_PASSWORD}@db:5432/lexora`,
    });
    expect(problems).toEqual([
      expect.stringMatching(/^DATABASE_URL: must use the least-privilege/),
    ]);
  });

  it.each([
    ["not a url", /valid URL/],
    [`mysql://lexora_app:${APP_PASSWORD}@db/lexora`, /postgresql:\/\/ scheme/],
    ["postgresql://db:5432/lexora", /user name and password/],
    [`postgresql://lexora_app:${APP_PASSWORD}@db:5432`, /name a database/],
  ])("rejects the database URL %j", (url, message) => {
    expect(problemsFor({ ...base, DATABASE_URL: url })).toEqual([expect.stringMatching(message)]);
  });

  it("rejects out-of-range numbers", () => {
    const problems = problemsFor({ ...base, PORT: "70000", TRUST_PROXY: "9" });
    expect(problems).toHaveLength(2);
  });

  it("never includes setting values in error messages", () => {
    const secretUrl = "postgresql://postgres:test-only-super-secret-value@db/lexora";
    try {
      loadConfig({ ...base, DATABASE_URL: secretUrl });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("test-only-super-secret-value");
    }
  });

  describe("secret files", () => {
    it("reads DATABASE_URL from DATABASE_URL_FILE and strips the trailing newline", () => {
      const config = loadConfig(
        { ...required, NODE_ENV: "development", DATABASE_URL_FILE: "/run/secrets/database_url" },
        (path) => {
          expect(path).toBe("/run/secrets/database_url");
          return `${validUrl}\n`;
        },
      );
      expect(config.databaseUrl).toBe(validUrl);
    });

    it("refuses both DATABASE_URL and DATABASE_URL_FILE", () => {
      const problems = problemsFor({ ...base, DATABASE_URL_FILE: "/x" }, () => validUrl);
      expect(problems).toEqual([expect.stringMatching(/not both/)]);
    });

    it("reports an unreadable secret file without exposing its path contents", () => {
      const problems = problemsFor(
        { ...required, NODE_ENV: "development", DATABASE_URL_FILE: "/missing" },
        () => {
          throw new Error("ENOENT");
        },
      );
      expect(problems).toContain("DATABASE_URL_FILE: the file could not be read");
    });
  });

  describe("production", () => {
    it("requires a database password of at least 24 characters", () => {
      const problems = problemsFor({
        ...productionRequired,
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://lexora_app:short@db:5432/lexora",
      });
      expect(problems).toEqual([expect.stringMatching(/at least 24 characters/)]);
    });

    it("refuses debug logging", () => {
      const problems = problemsFor({
        ...productionRequired,
        NODE_ENV: "production",
        DATABASE_URL: validUrl,
        LOG_LEVEL: "debug",
      });
      expect(problems).toEqual([expect.stringMatching(/^LOG_LEVEL: /)]);
    });

    it("accepts a strong production configuration", () => {
      const config = loadConfig({
        ...productionRequired,
        NODE_ENV: "production",
        DATABASE_URL: validUrl,
        HOST: "0.0.0.0",
        TRUST_PROXY: "1",
      });
      expect(config.isProduction).toBe(true);
      expect(config.trustProxy).toBe(1);
    });
  });

  describe("authentication settings", () => {
    it.each([
      ["too short", Buffer.alloc(16, 1).toString("base64")],
      ["too long", Buffer.alloc(48, 1).toString("base64")],
      ["not base64", "this is not base64 at all!!"],
    ])("rejects an MFA encryption key that is %s", (_label, key) => {
      const problems = problemsFor({ ...base, MFA_ENCRYPTION_KEY: key });
      expect(problems).toEqual([
        expect.stringMatching(/^MFA_ENCRYPTION_KEY: must be exactly 32 bytes/),
      ]);
      expect(problems.join()).not.toContain(key);
    });

    it("reads the MFA key from a secret file", () => {
      const config = loadConfig(
        {
          NODE_ENV: "development",
          DATABASE_URL: validUrl,
          APP_ORIGIN: required.APP_ORIGIN,
          MFA_ENCRYPTION_KEY_FILE: "/run/secrets/mfa",
        },
        () => `${TEST_KEY}
`,
      );
      expect(config.mfaEncryptionKey.equals(Buffer.alloc(32, 1))).toBe(true);
    });

    it.each(["http://127.0.0.1:5173/", "http://127.0.0.1:5173/app", "not-a-url"])(
      "rejects APP_ORIGIN %j (must be a bare origin)",
      (value) => {
        expect(problemsFor({ ...base, APP_ORIGIN: value })).toEqual([
          expect.stringMatching(/^APP_ORIGIN: /),
        ]);
      },
    );

    it("requires an https:// origin in production", () => {
      const problems = problemsFor({
        ...productionRequired,
        NODE_ENV: "production",
        DATABASE_URL: validUrl,
        APP_ORIGIN: "http://lexora.office.example",
      });
      expect(problems).toEqual([expect.stringMatching(/^APP_ORIGIN: must use https/)]);
    });

    it.each([
      ["ARGON2_MEMORY_KIB", "16384"],
      ["ARGON2_ITERATIONS", "1"],
    ])("refuses %s below the OWASP minimum, in every environment", (key, value) => {
      for (const NODE_ENV of ["development", "test"]) {
        expect(problemsFor({ ...base, NODE_ENV, [key]: value })).toEqual([
          expect.stringMatching(new RegExp(`^${key}: `)),
        ]);
      }
    });

    it("bounds session lifetimes", () => {
      expect(
        problemsFor({ ...base, SESSION_IDLE_MINUTES: "1", SESSION_ABSOLUTE_HOURS: "48" }),
      ).toHaveLength(2);
    });
  });
});
