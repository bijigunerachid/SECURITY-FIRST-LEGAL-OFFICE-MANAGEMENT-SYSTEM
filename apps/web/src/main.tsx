import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { createQueryClient, Providers } from "./app/providers";
import { createRouter } from "./app/router";
import { createI18n } from "./i18n";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <StrictMode>
    <Providers i18n={createI18n()} queryClient={createQueryClient()}>
      <RouterProvider router={createRouter()} />
    </Providers>
  </StrictMode>,
);
