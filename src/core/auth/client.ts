import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { withLocaleHeader } from "./locale";

export const authClient = createAuthClient({
  plugins: [emailOTPClient()],
  fetchOptions: {
    // 带上当前界面语言，服务端据此选择验证码邮件和欢迎邮件的语言。
    onRequest: withLocaleHeader,
  },
});
