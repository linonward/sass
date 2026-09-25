// 汇总所有模块的 onUserDelete 注册。删除账户的代码 import 本文件，保证执行前都已注册。
// 套件模块在这里 import 自己的注册文件；
// 业务模块同样在这里加一行 import "@/features/<name>/on-user-delete"。
import "@/core/billing/register-user-delete";
