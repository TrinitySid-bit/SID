import type { NextPageContext } from "next";

function ErrorPage({ statusCode }: { statusCode?: number }) {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>Something went wrong</h1>
      <p>Status: {statusCode ?? "Unknown"}</p>
      <p style={{ opacity: 0.8, marginTop: 8 }}>
        Try refresh (Ctrl+R) or come back to the homepage.
      </p>
    </div>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode ?? (err as any)?.statusCode ?? 500;
  return { statusCode };
};

export default ErrorPage;
