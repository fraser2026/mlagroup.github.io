# App layout — PageFrame

Three persistent zones. The middle work column densifies when the rail opens.

```
┌──────────┬─────────────────────────┬──────────────┐
│ Sidebar  │  PageFrame.main         │ ContextRail  │
│ (nav)    │  (scrolls)              │ (On this     │
│          │                         │  page +      │
│          │                         │  members)    │
└──────────┴─────────────────────────┴──────────────┘
```

**Rail:** Available on list and detail pages. Toggle from top chrome. When open, pages that need it (e.g. Registry descriptions) condense secondary text via `[data-rail-open='1']` so columns stay aligned — do not remove the rail to “fix” width.

**Dual scroll:** shell is viewport-locked. Middle and rail scroll independently.
