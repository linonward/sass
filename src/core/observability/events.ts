// Conversion events (Vercel Analytics custom events). Event names and properties are listed here;
// add your own product events in src/features following the same format and call the same
// track() / trackServer().
// Properties must be flat string / number / boolean / null values, with names and values of at
// most 255 characters. Don't include personal data such as email addresses, names, or payment
// details.

export const trackEvents = {
  /** A new user signed up (server side, after Better Auth creates the user). No properties. */
  signUp: "sign_up",
  /**
   * Checkout session created, about to redirect to the payment provider (client side).
   * Properties: plan.
   */
  checkoutStarted: "checkout_started",
  /**
   * First successful payment (server side, billing's checkout.completed). Properties: plan.
   * Renewals don't count.
   */
  purchase: "purchase",
} as const;

export type TrackEventName =
  | (typeof trackEvents)[keyof typeof trackEvents]
  // Your own custom event names.
  | (string & {});

export type TrackProperties = Record<string, string | number | boolean | null>;
