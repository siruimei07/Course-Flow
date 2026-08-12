import type { SVGProps } from "react";

export type IconName =
  | "arrow"
  | "book"
  | "calendar"
  | "chart"
  | "check"
  | "clock"
  | "file"
  | "home"
  | "plus"
  | "settings"
  | "tag"
  | "tasks";

export function Icon({ name, ...props }: Readonly<{ name: IconName } & SVGProps<SVGSVGElement>>) {
  const path = (() => {
    switch (name) {
      case "home":
        return <path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-5v-7h-4v7H5a2 2 0 0 1-2-2Z" />;
      case "book":
        return (
          <>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
          </>
        );
      case "calendar":
        return (
          <>
            <path d="M8 2v4M16 2v4M3 10h18" />
            <rect x="3" y="4" width="18" height="18" rx="3" />
          </>
        );
      case "tasks":
        return (
          <>
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="m8 12 3 3 5-6" />
          </>
        );
      case "file":
        return (
          <>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <path d="M14 2v6h6M8 13h8M8 17h6" />
          </>
        );
      case "chart":
        return <path d="M4 20V10M10 20V4M16 20v-7M22 20V7" />;
      case "plus":
        return <path d="M12 5v14M5 12h14" />;
      case "arrow":
        return <path d="M5 12h14M13 6l6 6-6 6" />;
      case "clock":
        return (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </>
        );
      case "check":
        return <path d="m5 12 4 4L19 6" />;
      case "tag":
        return (
          <>
            <path d="M20 13 11 22l-9-9V2h11Z" />
            <circle cx="7.5" cy="7.5" r="1.5" />
          </>
        );
      case "settings":
        return (
          <>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
          </>
        );
    }
  })();
  return (
    <svg aria-hidden="true" className="icon" fill="none" viewBox="0 0 24 24" {...props}>
      {path}
    </svg>
  );
}
