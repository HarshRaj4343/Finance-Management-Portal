import { redirect } from "next/navigation";

// The separate Bill Editor desk was retired: bills are now corrected on the
// Bill Employee desk, within the edit window or after a hold or rejection.
// Kept as a redirect so old bookmarks still land somewhere useful.
export default function BillEditorPage() {
  redirect("/apply-bill");
}
