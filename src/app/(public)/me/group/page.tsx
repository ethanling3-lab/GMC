import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Group reports now live inside each course (Courses → <course> → Groups tab),
// so the standalone /me/group index just redirects into the courses area.
export default function MeGroupIndexPage() {
  redirect("/me/courses");
}
