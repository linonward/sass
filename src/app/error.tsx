"use client";

import { useEffect } from "react";

import { Button } from "@/core/ui/button";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="text-muted-foreground">
        An unexpected error occurred. Please try again.
      </p>
      {error.digest && (
        <p className="text-muted-foreground font-mono text-xs">
          Error ID: {error.digest}
        </p>
      )}
      <Button onClick={() => retry()}>Try again</Button>
    </main>
  );
}
