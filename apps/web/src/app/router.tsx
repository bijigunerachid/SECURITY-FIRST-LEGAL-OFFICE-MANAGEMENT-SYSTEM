import { createBrowserRouter, type RouteObject } from "react-router";
import { AppShell } from "@/components/layout/app-shell";
import { StatusPage } from "@/features/status/status-page";
import { NotFoundPage } from "@/routes/not-found";
import { RouteErrorPage } from "@/routes/route-error";

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <StatusPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
