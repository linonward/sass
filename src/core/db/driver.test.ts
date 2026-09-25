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
    // 只看主机名，路径或参数里出现 neon.tech 不算。
    ["postgres://u:p@localhost/neon.tech", "pg"],
    ["postgres://u:p@notneon.tech/db", "pg"],
  ])("%s 使用 %s", (url, expected) => {
    expect(driverFor(url)).toBe(expected);
  });
});
