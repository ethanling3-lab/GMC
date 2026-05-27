"use client";

import { useEffect, type ReactNode } from "react";
import { useSelection } from "./SelectionContext";
import { InboxBulkToolbar } from "./InboxBulkToolbar";

// Client shell mounted INSIDE the server-rendered ConversationListView. Its
// jobs:
//   1. Register the visible row ids with the SelectionContext so j/k nav,
//      "select all", and the toolbar count have a source of truth.
//   2. Render the BulkToolbar above the children — sticky at the top of the
//      scroll container, slides in via CSS when ≥1 selected.
//
// The actual <ul> + <li> rows stay server-rendered (passed through as
// `children`). This keeps the data-fetch path RSC while only opting the
// interactive scaffolding into the client bundle.

export function SelectionShell({
  rowIds,
  compact,
  children,
}: {
  rowIds: string[];
  compact: boolean;
  children: ReactNode;
}) {
  const { setRowIds } = useSelection();

  // Register on mount + whenever the visible row set changes. setRowIds()
  // also prunes selected/focused state down to the new visible set.
  useEffect(() => {
    setRowIds(rowIds);
  }, [rowIds, setRowIds]);

  return (
    <>
      <InboxBulkToolbar compact={compact} />
      {children}
    </>
  );
}
