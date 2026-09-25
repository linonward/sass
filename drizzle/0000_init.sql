-- 初始迁移：不建表，只用来建立迁移记录表（drizzle.__drizzle_migrations），
-- 让空库上的 `pnpm db:migrate` 有实际可验证的结果。后续表结构由 `pnpm db:generate` 生成。
SELECT 1;
