import ErrorComponent from "next/error";

type Props = { statusCode?: number };

function MyError({ statusCode }: Props) {
  return <ErrorComponent statusCode={statusCode ?? 500} />;
}

// Keep this minimal and typed; Next will pass ctx here on errors
MyError.getInitialProps = (ctx: { res?: { statusCode?: number } | null; err?: { statusCode?: number } | null }): Props => {
  const statusCode = ctx.res?.statusCode ?? ctx.err?.statusCode ?? 404;
  return { statusCode };
};

export default MyError;
