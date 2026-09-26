// 转化事件（Vercel Analytics 自定义事件）。事件名和属性都列在这里，业务的新事件照这个格式加在
// src/features 里，调用同一个 track() / trackServer()。
// 属性只能是扁平的 string / number / boolean / null，名字和值都不超过 255 个字符；
// 不要放邮箱、姓名、支付信息等个人数据。

export const trackEvents = {
  /** 新用户注册（服务端，Better Auth 创建用户后）。无属性。 */
  signUp: "sign_up",
  /** 结账页已创建、即将跳转到支付服务商（客户端）。属性：plan。 */
  checkoutStarted: "checkout_started",
  /** 首次付款成功（服务端，billing 的 checkout.completed）。属性：plan。续费不算。 */
  purchase: "purchase",
} as const;

export type TrackEventName =
  | (typeof trackEvents)[keyof typeof trackEvents]
  // 业务自定义的事件名。
  | (string & {});

export type TrackProperties = Record<string, string | number | boolean | null>;
