// 套件的表在这个目录下按模块分文件定义，并从这里汇总导出，供 drizzle() 的 schema 参数使用。
// 业务的表放在 src/features/*/schema.ts，由 drizzle.config.ts 一并收录生成迁移。
export * from "./auth";
export * from "./credits";
export * from "./billing";
export * from "./notifications";
export * from "./files";
export * from "./ai";
