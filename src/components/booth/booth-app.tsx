"use client";

// BoothApp — root of the local booth staff system.
// Self-contained: owns its TanStack Query client, auth gate, and view state.
// The orchestrator renders <BoothApp /> when the store mode is "booth".

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BoothView } from "@/lib/constants";
import BoothShell from "./booth-shell";

export default function BoothApp() {
  const [view, setView] = React.useState<BoothView>("dashboard");

  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: true,
            staleTime: 5000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BoothShell view={view} onNavigate={setView} />
    </QueryClientProvider>
  );
}
