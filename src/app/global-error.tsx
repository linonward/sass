"use client";

import { useEffect } from "react";

import { captureError } from "@/core/observability/sentry";

// Replaces the whole document when the root layout fails, so globals.css and the theme aren't
// available; inline styles only.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
    captureError(error);
  }, [error]);

  return (
    // lang and copy are hard-coded in English: this file replaces the whole root layout and can't reach
    // NextIntlClientProvider — a framework constraint, not laziness. That matches locales: ["en"] in
    // site.config.ts today; if you add locales, handle this page yourself (e.g. pick lang and copy from
    // Accept-Language), or the global error page won't follow.
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          colorScheme: "light dark",
        }}
      >
        <title>Something went wrong</title>
        <main style={{ textAlign: "center", padding: "1rem" }}>
          <h1>Something went wrong</h1>
          <p>An unexpected error occurred. Please try again.</p>
          <button type="button" onClick={() => retry()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
