import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./env.js";

const APP_PASSWORD = "test-only-app-password-long-enough";
const validUrl = `postgresql://lexora_app:${APP_PASSWORD}@db:5432/lexora`;

const base = {
  NODE_ENV: "development",
  DATABASE_URL: validUrl,
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
        { NODE_ENV: "development", DATABASE_URL_FILE: "/run/secrets/database_url" },
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
        { NODE_ENV: "development", DATABASE_URL_FILE: "/missing" },
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
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://lexora_app:short@db:5432/lexora",
      });
      expect(problems).toEqual([expect.stringMatching(/at least 24 characters/)]);
    });

    it("refuses debug logging", () => {
      const problems = problemsFor({
        NODE_ENV: "production",
        DATABASE_URL: validUrl,
        LOG_LEVEL: "debug",
      });
      expect(problems).toEqual([expect.stringMatching(/^LOG_LEVEL: /)]);
    });

    it("accepts a strong production configuration", () => {
      const config = loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: validUrl,
        HOST: "0.0.0.0",
        TRUST_PROXY: "1",
      });
      expect(config.isProduction).toBe(true);
      expect(config.trustProxy).toBe(1);
    });
  });
});
