"use client";

import * as React from "react";

interface PauseContextType {
  isPaused: boolean;
  pauseConsole: () => void;
  resumeConsole: () => void;
}

const PauseContext = React.createContext<PauseContextType | undefined>(
  undefined,
);

export function PauseProvider({ children }: { children: React.ReactNode }) {
  const [isPaused, setIsPaused] = React.useState(false);
  const [isMounted, setIsMounted] = React.useState(false);

  React.useEffect(() => {
    setIsMounted(true);
    const storedState = localStorage.getItem("console_paused");
    if (storedState === "true") {
      setIsPaused(true);
    }
  }, []);

  const pauseConsole = () => {
    setIsPaused(true);
    localStorage.setItem("console_paused", "true");
  };

  const resumeConsole = () => {
    setIsPaused(false);
    localStorage.removeItem("console_paused");
  };

  if (!isMounted) return null;

  return (
    <PauseContext.Provider value={{ isPaused, pauseConsole, resumeConsole }}>
      {children}
    </PauseContext.Provider>
  );
}

export function usePause() {
  const context = React.useContext(PauseContext);
  if (!context) {
    throw new Error("usePause must be used within a PauseProvider");
  }
  return context;
}
