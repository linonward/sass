// 登录相关的自定义错误码。服务端和登录页共用，不要在这里引入服务端代码。

/** 同一邮箱的重发冷却中。 */
export const RESEND_COOLDOWN = "RESEND_COOLDOWN";

/** 验证码邮件没发出去。 */
export const EMAIL_SEND_FAILED = "EMAIL_SEND_FAILED";
