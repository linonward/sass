// 汇总所有模块的 onBillingEvent 注册。handleBillingEvent import 本文件，保证处理事件前都已注册。
// 套件的钩子在 ./register-hooks.ts（发放积分）；
// 业务模块同样在这里加一行 import "@/features/<name>/on-billing-event"。
import "./register-hooks";
