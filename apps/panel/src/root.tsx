import type { ReactNode } from "react";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "react-router";
// Self-hosted fonts (Sora for UI and body, Poppins for display and body-light):
// bundled by Vite, so no page ever requests a font CDN.
import "@fontsource/sora/latin-400.css";
import "@fontsource/sora/latin-600.css";
import "@fontsource/sora/latin-700.css";
import "@fontsource/poppins/latin-300.css";
import "@fontsource/poppins/latin-400.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/shell.css";
import "./styles/primitives-display.css";
import "./styles/primitives-feedback.css";
import "./styles/primitives-data.css";
import "./styles/inventory.css";
import "./styles/application.css";
import "./styles/standards.css";
import "./styles/new-application.css";
import "./styles/project-tree.css";
import "./styles/accepted-deviation.css";
import "./styles/compilations.css";
import "./styles/guidance-access.css";
import "./styles/sign-in.css";
import "./styles/polish.css";
import { tokenCss } from "./design/tokens.ts";

const TOKENS = tokenCss();

export function Layout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <style dangerouslySetInnerHTML={{ __html: TOKENS }} />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/** No stack trace or driver text ever reaches the page. */
export function ErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <main className="sign-in">
      <p className="sign-in__wordmark">Domain Harness</p>
      <h1 className="type-title">{notFound ? "Page not found" : "Something went wrong"}</h1>
      <p>
        <a href="/inventory">Go to Inventory</a>
      </p>
    </main>
  );
}
