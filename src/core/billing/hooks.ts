// 汇总所有模块的 onBillingEvent 注册。handleBillingEvent import 本文件，保证处理事件前都已注册。
// 套件模块在这里 import 自己的注册文件（例如 T303：import "@/core/credits/on-billing-event"）；
// 业务模块同样在这里加一行 import "@/features/<name>/on-billing-event"。
export {};
