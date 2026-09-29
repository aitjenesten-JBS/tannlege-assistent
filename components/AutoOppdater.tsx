"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoOppdater() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <p className="mt-2 flex items-center gap-2 text-xs text-daempet">
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full bg-fjord motion-safe:animate-pulse"
      />
      Oppdateres automatisk
    </p>
  );
}
