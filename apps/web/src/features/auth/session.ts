import { sessionResponseSchema, type SessionResponse } from "@lexora/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, isApiError, setCsrfToken } from "@/lib/api";

export const sessionQueryKey = ["auth", "session"] as const;

/** The current session, or null when signed out. The server is the only source of truth. */
async function fetchSession(signal: AbortSignal): Promise<SessionResponse | null> {
  try {
    const session = await getJson("/api/auth/session", sessionResponseSchema, { signal });
    setCsrfToken(session.csrfToken);
    return session;
  } catch (error) {
    if (isApiError(error, "unauthenticated")) {
      setCsrfToken(null);
      return null;
    }
    throw error;
  }
}

export function useSession() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => fetchSession(signal),
    staleTime: 60_000,
    retry: false,
    // Notice an expired session soon after the user returns to the tab.
    refetchOnWindowFocus: true,
  });
}

/** After sign-in, sign-out or any change to the session, reload it from the server. */
export function useRefreshSession() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    return queryClient.query({
      queryKey: sessionQueryKey,
      queryFn: ({ signal }) => fetchSession(signal),
    });
  };
}

/** Clears every cached response, so nothing from one user is shown to the next. */
export function useForgetEverything() {
  const queryClient = useQueryClient();
  return () => {
    setCsrfToken(null);
    queryClient.clear();
  };
}
