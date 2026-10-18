import { readinessResponseSchema } from "@lexora/shared";
import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/lib/api";

export const readinessQueryKey = ["health", "ready"] as const;

/** Readiness answers 503 with a valid body when the database is down. */
export function useReadiness() {
  return useQuery({
    queryKey: readinessQueryKey,
    queryFn: ({ signal }) =>
      getJson("/api/health/ready", readinessResponseSchema, { signal, acceptStatuses: [503] }),
    refetchInterval: 30_000,
    retry: false,
  });
}
