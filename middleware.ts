import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isAdminPath = pathname.startsWith("/admin");
  const isMePath = pathname.startsWith("/me");

  if (!isAdminPath && !isMePath) return NextResponse.next();

  // Pass the request pathname down to server components via a header so
  // AdminShell can compute auto-collapse state SSR-side and avoid a
  // hydration mismatch with the client `usePathname()` (which can briefly
  // be null on first render in dev with parallel routes).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isAdminPath) {
    const isLogin = pathname === "/admin/login" || pathname === "/admin/login/";
    if (isLogin) {
      if (user) return NextResponse.redirect(new URL("/admin", req.url));
      return res;
    }
    if (!user) {
      const url = new URL("/admin/login", req.url);
      if (pathname !== "/admin") url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    // Deep admin-row check happens in the protected layout (requireAdmin()).
    return res;
  }

  // /me/*
  if (!user) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  // Deep participant-row check happens in the /me layout (requireParticipant()).
  return res;
}

export const config = {
  matcher: ["/admin/:path*", "/me/:path*"],
};
