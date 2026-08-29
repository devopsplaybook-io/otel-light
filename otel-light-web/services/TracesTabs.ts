/**
 * Tabs shared by all the traces pages: the main trace list and the
 * statistics views. Labels are intentionally short so the tab bar stays
 * usable on narrow screens (it scrolls horizontally / ellipsizes if needed).
 * `exact` prevents the list tab from matching the stats sub-routes.
 */
export const TracesTabs = [
  { id: "list", label: "Traces", to: "/traces", exact: true },
  {
    id: "aggregated",
    label: "Aggregated",
    to: "/traces/stats/aggregated",
  },
  {
    id: "longest",
    label: "Longest",
    to: "/traces/stats/longest",
  },
  {
    id: "most-called",
    label: "Most Called",
    to: "/traces/stats/most-called",
  },
];
