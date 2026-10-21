import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { i18n } from "i18next";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { ReauthProvider } from "@/features/auth/reauth";
import { sessionQueryKey } from "@/features/auth/session";
import { isApiError } from "@/lib/api";

export function createQueryClient(): QueryClient {
  // When any request reports that the session is gone (expired, revoked,
  // account disabled), reload the session; the route guards then send the
  // user to the sign-in page.
  const onError = (error: unknown) => {
    if (isApiError(error, "unauthenticated")) {
      void client.invalidateQueries({ queryKey: sessionQueryKey });
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => !isApiError(error) && count < 2,
      },
    },
  });
  return client;
}

export function Providers({
  i18n,
  queryClient,
  children,
}: {
  i18n: i18n;
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ReauthProvider>{children}</ReauthProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
