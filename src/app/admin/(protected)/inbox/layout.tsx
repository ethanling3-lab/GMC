import { SelectionProvider } from "@/components/admin/inbox/selection/SelectionContext";
import { InboxKeyboardHost } from "@/components/admin/inbox/selection/InboxKeyboardHost";

// Inbox layout — composes three parallel slots/children:
//   [ sidebar 260px ] [ list 440px (xl+) ] [ children fills rest ]
//
// All three are scoped to /admin/inbox/* via the layout's existence. When
// the user navigates away, the whole layout unmounts and the slots
// unmount with it — no slot-persistence issue.
//
// Selection + global keyboard live at this level so they survive
// soft-nav between threads (select 3 rows, click into one, come back —
// the selection is still active).
//
// Negative margins escape AdminShell's standard `px-6 md:px-10 py-10`
// padding so the inbox UI is full-bleed within the main content area.
// Height clamps to viewport-minus-TopBar; the inner page area is
// `overflow-hidden flex flex-col` so each page (page.tsx, [id]/page.tsx)
// owns its own scroll/composer split.

export default function InboxLayout({
  children,
  list,
  sidebar,
}: {
  children: React.ReactNode;
  list: React.ReactNode;
  sidebar: React.ReactNode;
}) {
  return (
    <SelectionProvider>
      <InboxKeyboardHost />
      <div className="-mx-6 md:-mx-10 -my-10 flex h-[calc(100dvh-4rem)] min-h-0">
        <aside
          className="hidden lg:flex flex-none w-[260px] h-full
                     border-r border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                     overflow-hidden"
        >
          {sidebar}
        </aside>
        <aside
          className="hidden xl:flex flex-none w-[440px] h-full
                     border-r border-[var(--paper-shadow)] bg-[var(--paper-warm)]
                     overflow-hidden"
        >
          {list}
        </aside>
        <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
          {children}
        </div>
      </div>
    </SelectionProvider>
  );
}
