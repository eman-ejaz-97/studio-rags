import { NextResponse, type NextRequest } from "next/server";
import { apiOrigin } from "@/lib/api-origin";
import { apiProxyHeaders } from "@/lib/api-proxy-headers";

/**
 * Runs before every /api/v1 request. With API_PROXY_SECRET set (Vercel only),
 * it forwards the request to the API itself, adding the signed visitor
 * address from api-proxy-headers.ts. Next's docs promise request headers set
 * here reach a rewrite made here; they do not say the same for the
 * next.config.ts rewrite, so this does not rely on it.
 *
 * Without the secret it does nothing, and next.config.ts's rewrite forwards
 * the request as before.
 */
export function proxy(request: NextRequest) {
  const headers = apiProxyHeaders(request.headers);
  if (!headers) return NextResponse.next();

  // Path and query kept as the browser sent them, as the config rewrite does:
  // the refresh cookie's Path=/api/v1/auth must still match.
  const { pathname, search } = request.nextUrl;
  return NextResponse.rewrite(new URL(`${pathname}${search}`, apiOrigin()), {
    request: { headers },
  });
}

export const config = {
  matcher: "/api/v1/:path*",
};
