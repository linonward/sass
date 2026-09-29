import { describe, expect, test } from "vitest";

import { driverFor } from "./driver";

describe("driverFor", () => {
  test.each([
    [
      "postgres://u:p@ep-cool-name-123.us-east-1.aws.neon.tech/db?sslmode=require",
      "neon",
    ],
    ["postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db", "neon"],
    ["postgres://postgres:postgres@localhost:5432/postgres", "pg"],
    ["postgres://u:p@db.example.com:5432/app", "pg"],
    // Only the hostname counts; neon.tech in the path or query string doesn't.
    ["postgres://u:p@localhost/neon.tech", "pg"],
    ["postgres://u:p@notneon.tech/db", "pg"],
  ])("%s uses %s", (url, expected) => {
    expect(driverFor(url)).toBe(expected);
  });
});
