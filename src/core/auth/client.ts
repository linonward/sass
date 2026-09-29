import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { withLocaleHeader } from "./locale";

export const authClient = createAuthClient({
  plugins: [emailOTPClient()],
  fetchOptions: {
    // Send the current UI locale; the server uses it to pick the language of the verification code
    // email and the welcome email.
    onRequest: withLocaleHeader,
  },
});
