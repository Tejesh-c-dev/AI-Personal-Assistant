import type { ReactNode } from "react";

type IconName =
  | "arrow-up"
  | "calendar"
  | "chevron-down"
  | "chevron-right"
  | "close"
  | "file"
  | "inbox"
  | "menu"
  | "message"
  | "plus"
  | "search"
  | "settings"
  | "spark"
  | "web"
  | "panel"
  | "trash"
  | "edit"
  | "check"
  | "refresh"
  | "alert";

type IconProps = {
  name: IconName;
  className?: string;
};

const paths: Record<IconName, ReactNode> = {
  "arrow-up": <path d="m5 12 14-7-4 7 4 7-14-7Z" />,
  calendar: <><rect width="16" height="16" x="4" y="4" rx="2" /><path d="M8 2v4M16 2v4M4 10h16" /></>,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
  inbox: <><path d="M4 4h16v16H4z" /><path d="M4 14h4l2 3h4l2-3h4" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  message: <><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.5 8.5 0 0 1-3-.55L4 20l1.55-3.85A7.4 7.4 0 0 1 4.5 12a7.5 7.5 0 1 1 15.5-.5Z" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.42 1.42-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.56V20h-2v-.48a1.7 1.7 0 0 0-1-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.42-1.42.06-.06A1.7 1.7 0 0 0 9.5 15a1.7 1.7 0 0 0-1.56-1H7v-2h.94a1.7 1.7 0 0 0 1.56-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.42-1.42.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1-1.56V6h2v.48a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.42 1.42-.06.06A1.7 1.7 0 0 0 19.5 11c.08.58.57 1 1.16 1H21v2h-.34a1.7 1.7 0 0 0-1.26 1Z" /></>,
  spark: <><path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3Z" /><path d="m19 16 .5 2.5L22 19l-2.5.5L19 22l-.5-2.5L16 19l2.5-.5L19 16Z" /></>,
  web: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  trash: <><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>,
  edit: <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />,
  check: <path d="M20 6 9 17l-5-5" />,
  refresh: <><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></>,
  alert: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
};

export function Icon({ name, className = "size-4" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">
      {paths[name]}
    </svg>
  );
}

export type { IconName };
