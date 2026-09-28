// 临时文件：闸门变异校验。故意让 invoices 这条 e2e 腿失败，确认末尾的 `ci`
// 汇总闸门真的会变红 —— 闸门在失败时静默放行比没有闸门更糟，所以这一条要实测。
// 校验完即删除，不留在 final diff 里。
import { expect, test } from "@playwright/test";

test("变异校验：这条故意失败", () => {
  expect("故意失败").toBe("不应相等");
});
