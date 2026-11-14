"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Icon } from "../ui/icons";
import type { User } from "@/lib/db/schema";

type ChatHeaderProps = {
  onMenuClick: () => void;
  isSidebarCollapsed: boolean;
  isSidebarOpen?: boolean;
  isAccountPanelOpen?: boolean;
  title?: string;
  subtitle?: string;
  user?: Pick<User, "name" | "email" | "picture">;
  onToggleAccountPanel?: () => void;
  onOpenManageAccounts?: () => void;
};

export function ChatHeader({
  onMenuClick,
  isSidebarCollapsed,
  isSidebarOpen = false,
  isAccountPanelOpen = false,
  title = "New conversation",
  subtitle = "Enterprise Google Workspace Assistant",
  user,
  onToggleAccountPanel,
  onOpenManageAccounts,
}: ChatHeaderProps) {
  const router = useRouter();
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Close profile menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node)
      ) {
        setIsProfileMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/sign-in");
    }
  };

  const userInitials = user?.name
    ? user.name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "U";

  return (
    <header className="h-[68px] shrink-0 border-b border-[#DCE4ED] bg-[#FFFFFF] px-4 sm:px-6">
      <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-between">
        {/* Left: Sidebar Toggle & Page Title */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            aria-controls="left-sidebar"
            aria-expanded={isSidebarCollapsed ? false : isSidebarOpen}
            aria-label={
              isSidebarCollapsed
                ? "Expand sidebar"
                : isSidebarOpen
                  ? "Close navigation"
                  : "Open navigation"
            }
            className={`flex size-9 items-center justify-center rounded-lg border border-[#DCE4ED] bg-[#FFFFFF] text-[#64748B] shadow-xs hover:bg-[#F1F5F9] hover:text-[#172B4D] focus:outline-none focus:ring-2 focus:ring-[#315F85]/30 ${
              isSidebarCollapsed ? "flex" : "flex lg:hidden"
            }`}
            onClick={onMenuClick}
            title={
              isSidebarCollapsed
                ? "Expand sidebar"
                : isSidebarOpen
                  ? "Close navigation"
                  : "Open navigation"
            }
            type="button"
          >
            <Icon className="size-4" name={isSidebarCollapsed ? "panel" : "menu"} />
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#15945B]" />
              <h1 className="truncate text-sm font-semibold tracking-tight text-[#172B4D]">
                {title}
              </h1>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-[#64748B]">
              {subtitle}
            </p>
          </div>
        </div>

        {/* Right: Actions, Account Panel Toggle & Profile Menu */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Right Account Panel Toggle */}
          {onToggleAccountPanel && (
            <button
              aria-controls="right-account-panel"
              aria-expanded={isAccountPanelOpen}
              aria-label={isAccountPanelOpen ? "Close Google Account details" : "Open Google Account details"}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-xs transition hover:bg-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-[#315F85]/30 ${
                isAccountPanelOpen
                  ? "border-[#315F85] bg-[#F1F5F9] text-[#172B4D]"
                  : "border-[#DCE4ED] bg-[#FFFFFF] text-[#172B4D]"
              }`}
              onClick={onToggleAccountPanel}
              title={isAccountPanelOpen ? "Close Google Account details" : "Open Google Account details"}
              type="button"
            >
              <Icon className="size-3.5 text-[#172B4D]" name="google" />
              <span className="hidden sm:inline">Google Account</span>
            </button>
          )}

          {/* User Profile Menu */}
          {user && (
            <div className="relative" ref={profileMenuRef}>
              <button
                aria-expanded={isProfileMenuOpen}
                aria-haspopup="true"
                aria-label="User profile menu"
                className="flex items-center gap-2 rounded-full p-0.5 text-left transition hover:ring-2 hover:ring-[#DCE4ED] focus:outline-none focus:ring-2 focus:ring-[#315F85]/30"
                onClick={() => setIsProfileMenuOpen((prev) => !prev)}
                type="button"
              >
                {user.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={user.name}
                    className="size-8 rounded-full object-cover border border-[#DCE4ED]"
                    src={user.picture}
                  />
                ) : (
                  <div className="flex size-8 items-center justify-center rounded-full bg-[#315F85] text-xs font-semibold text-white">
                    {userInitials}
                  </div>
                )}
                <div className="hidden text-left sm:block">
                  <p className="text-xs font-medium text-[#172B4D] leading-none">
                    {user.name}
                  </p>
                </div>
                <Icon
                  className="hidden size-3.5 text-[#64748B] sm:block"
                  name="chevron-down"
                />
              </button>

              {/* Profile Dropdown Menu */}
              {isProfileMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-[#DCE4ED] bg-[#FFFFFF] p-2 shadow-lg z-50">
                  <div className="border-b border-[#DCE4ED] px-3 py-2.5">
                    <p className="text-xs font-semibold text-[#172B4D]">
                      {user.name}
                    </p>
                    <p className="truncate text-[11px] text-[#64748B]">
                      {user.email}
                    </p>
                  </div>

                  <div className="py-1">
                    {onOpenManageAccounts && (
                      <button
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-[#172B4D] hover:bg-[#F1F5F9]"
                        onClick={() => {
                          setIsProfileMenuOpen(false);
                          onOpenManageAccounts();
                        }}
                        type="button"
                      >
                        <Icon className="size-3.5 text-[#64748B]" name="settings" />
                        <span>Manage Accounts</span>
                      </button>
                    )}
                  </div>

                  <div className="border-t border-[#DCE4ED] pt-1">
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-[#C2413B] hover:bg-[#C2413B]/10"
                      onClick={() => {
                        setIsProfileMenuOpen(false);
                        void handleSignOut();
                      }}
                      type="button"
                    >
                      <Icon className="size-3.5" name="close" />
                      <span>Sign out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
