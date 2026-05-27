import { SelectionProvider } from "@/components/admin/inbox/selection/SelectionContext";
import { InboxKeyboardHost } from "@/components/admin/inbox/selection/InboxKeyboardHost";
import { InboxFrame } from "@/components/admin/inbox/InboxFrame";

// Inbox layout — composes three parallel slots/children:
//   [ sidebar 260px ] [ list (320px OR flex-1 when no thread) ] [ thread ]
//
// All three are scoped to /admin/inbox/* via the layout's existence. When
// the user navigates away, the whole layout unmounts and the slots
// unmount with it — no slot-persistence issue.
//
// The 3-column flex is delegated to <InboxFrame> (client) because it
// reads usePathname() to decide whether the list pane should fill the
// otherwise-empty xl+ screen or sit in its 320px column. Layout itself
// stays server-rendered + owns the SelectionProvider + KeyboardHost so
// selection/keyboard state survive soft-nav between threads.
//
// Negative margins escape AdminShell's standard `px-6 md:px-10 py-10`
// padding so the inbox UI is full-bleed within the main content area.
// Height clamps to viewport-minus-TopBar.

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
      <InboxFrame sidebar={sidebar} list={list}>
        {children}
      </InboxFrame>
    </SelectionProvider>
  );
}
