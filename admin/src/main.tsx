import { button } from "./control-styles";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { AuthProvider, queryClient, ReportProvider } from "./state";
import { Workspace } from "./workspace";
import { ReportPage } from "./reports";
import { OperationsPage } from "./operations";
import { AccountsPage, SecurityPage } from "./accounts";
import { Empty } from "./ui";
import "./styles.css";

const root = createRootRoute({
  component: Workspace,
  notFoundComponent: () => (
    <Empty title="Page not found">
      Choose a section from the workspace navigation.
    </Empty>
  ),
});
const overview = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: () => <ReportPage view="overview" />,
});
const reports = [
  "traffic",
  "funnel",
  "retention",
  "campaigns",
  "coverage",
] as const;
const operations = ["users", "connections", "trades", "audit"] as const;
const routeTree = root.addChildren([
  overview,
  ...reports.map((view) =>
    createRoute({
      getParentRoute: () => root,
      path: `/${view}`,
      component: () => <ReportPage view={view} />,
    }),
  ),
  ...operations.map((view) =>
    createRoute({
      getParentRoute: () => root,
      path: `/${view}`,
      component: () => <OperationsPage view={view} />,
    }),
  ),
  createRoute({
    getParentRoute: () => root,
    path: "/accounts",
    component: AccountsPage,
  }),
  createRoute({
    getParentRoute: () => root,
    path: "/security",
    component: SecurityPage,
  }),
]);
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

class Boundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="mx-auto grid min-h-dvh max-w-md content-center justify-items-start gap-3 px-6 [&>h1]:text-xl [&>h1]:font-semibold [&>p]:text-muted">
        <h1>This workspace needs a refresh</h1>
        <p>Reload to restore your session and try again.</p>
        <button className={button} onClick={() => window.location.reload()}>
          Reload workspace
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}

const reactRoot = ReactDOM.createRoot(document.getElementById("root")!);
// Route/context edits can invalidate this entry during local development.
// Dispose the previous root before Vite evaluates the replacement module.
if (import.meta.hot) import.meta.hot.dispose(() => reactRoot.unmount());
reactRoot.render(
  <React.StrictMode>
    <Boundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ReportProvider>
            <RouterProvider router={router} />
          </ReportProvider>
        </AuthProvider>
      </QueryClientProvider>
    </Boundary>
  </React.StrictMode>,
);
