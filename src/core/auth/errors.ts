// Custom sign-in error codes. Shared by the server and the sign-in page, so don't import server code
// here.

/** The resend cooldown for this email is still active. */
export const RESEND_COOLDOWN = "RESEND_COOLDOWN";

/** The verification code email could not be sent. */
export const EMAIL_SEND_FAILED = "EMAIL_SEND_FAILED";
