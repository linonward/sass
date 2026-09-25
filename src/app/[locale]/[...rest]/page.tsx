import { notFound } from "next/navigation";

// 让 [locale] 下未匹配的路径渲染本地化的 not-found.tsx。
export default function CatchAll() {
  notFound();
}
