import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  canCallApi,
  canOpenPage,
  eventHomePath,
  landingPath,
} from "@/lib/staff/permissions";

const EVENT_HOME = /^\/admin\/events\/([^/]+)\/?$/;

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isAdminPath = pathname.startsWith("/admin");
  const isMePath = pathname.startsWith("/me");
  const isAdminApi = pathname.startsWith("/api/admin/");

  if (!isAdminPath && !isMePath && !isAdminApi) return NextResponse.next();

  // Sign-in and sign-out must work before a role is known.
  if (isAdminApi && pathname.startsWith("/api/admin/auth/")) {
    return NextResponse.next();
  }

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

  if (isAdminApi) {
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const access = await loadStaffRole(supabase, user.id);
    if (access.status === "error") {
      return NextResponse.json({ error: "access_check_failed" }, { status: 503 });
    }
    if (access.status !== "staff" || !canCallApi(access.role, req.method, pathname)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return res;
  }

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

    const access = await loadStaffRole(supabase, user.id);
    if (access.status === "error") {
      return new NextResponse("Could not check your access. Please try again.", {
        status: 503,
      });
    }
    // Not staff: the protected layout signs them out with the right message.
    if (access.status === "not_staff") return res;

    const { role } = access;
    const eventHome = pathname.match(EVENT_HOME);
    if (eventHome && eventHome[1] !== "new") {
      const target = eventHomePath(role, eventHome[1]);
      if (target) return NextResponse.redirect(new URL(target, req.url));
    }
    if (!canOpenPage(role, pathname)) {
      const landing = landingPath(role);
      if (!landing) return new NextResponse("Forbidden", { status: 403 });
      return NextResponse.redirect(new URL(landing, req.url));
    }
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

type StaffAccess =
  | { status: "staff"; role: string }
  | { status: "not_staff" }
  | { status: "error" };

async function loadStaffRole(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
): Promise<StaffAccess> {
  const { data, error } = await supabase
    .from("admins")
    .select("role, deactivated_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { status: "error" };
  if (!data || data.deactivated_at) return { status: "not_staff" };
  return { status: "staff", role: data.role as string };
}

export const config = {
  matcher: ["/admin/:path*", "/me/:path*", "/api/admin/:path*"],
};
