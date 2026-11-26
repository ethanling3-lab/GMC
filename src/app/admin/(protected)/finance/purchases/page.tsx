import { redirect } from "next/navigation";

// The breadcrumb links here; purchases are listed on Instalments.
export default function PurchasesIndex() {
  redirect("/admin/finance/instalments?view=active");
}
