import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

import { ChatHeader } from "./chat-header";
import { Sidebar } from "./sidebar";
import { RightAccountPanel } from "./right-account-panel";
import type { GoogleAccount } from "@/components/accounts/account-api";
import type { ConversationSummary } from "@/components/chat/conversation-api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

describe("Sidebar Toggle Controls & Accessibility", () => {
  const dummyUser = {
    name: "Alex Morgan",
    email: "alex@example.com",
    picture: null,
  };

  const dummyConversations: ConversationSummary[] = [
    {
      id: "conv-1",
      sessionId: "session-1",
      title: "Project Architecture Discussion",
      account: "personal",
      createdAt: "2026-11-15T00:00:00Z",
      updatedAt: "2026-11-15T00:00:00Z",
    },
  ];

  const dummyAccounts: GoogleAccount[] = [
    {
      id: "acc-1",
      label: "personal",
      email: "alex@gmail.com",
      status: "active",
      grantedScopes: ["https://www.googleapis.com/auth/gmail.modify"],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];

  describe("ChatHeader Toggle Buttons", () => {
    it("renders reopen button for left sidebar when isSidebarCollapsed is true", () => {
      const html = renderToString(
        <ChatHeader
          isAccountPanelOpen={false}
          isSidebarCollapsed={true}
          isSidebarOpen={false}
          onMenuClick={() => {}}
          onToggleAccountPanel={() => {}}
          title="Test Title"
          user={dummyUser}
        />,
      );

      expect(html).toContain('aria-controls="left-sidebar"');
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain('aria-label="Expand sidebar"');
      expect(html).toContain('title="Expand sidebar"');
      // Should NOT have lg:hidden when collapsed (it must be visible on desktop to reopen)
      expect(html).not.toMatch(/class="[^"]*Expand sidebar[^"]*lg:hidden/);
    });

    it("renders navigation button when isSidebarCollapsed is false", () => {
      const html = renderToString(
        <ChatHeader
          isAccountPanelOpen={false}
          isSidebarCollapsed={false}
          isSidebarOpen={false}
          onMenuClick={() => {}}
          onToggleAccountPanel={() => {}}
          title="Test Title"
          user={dummyUser}
        />,
      );

      expect(html).toContain('aria-controls="left-sidebar"');
      expect(html).toContain('aria-label="Open navigation"');
      expect(html).toContain("lg:hidden");
    });

    it("renders persistent Google Account reopen button when account panel is closed", () => {
      const html = renderToString(
        <ChatHeader
          isAccountPanelOpen={false}
          isSidebarCollapsed={false}
          isSidebarOpen={false}
          onMenuClick={() => {}}
          onToggleAccountPanel={() => {}}
          title="Test Title"
          user={dummyUser}
        />,
      );

      expect(html).toContain('aria-controls="right-account-panel"');
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain('aria-label="Open Google Account details"');
      expect(html).toContain('title="Open Google Account details"');
      expect(html).toContain("Google Account");
      // Must not be hidden on desktop (xl:hidden removed)
      expect(html).not.toContain("xl:hidden");
    });

    it("renders active Google Account toggle button when account panel is open", () => {
      const html = renderToString(
        <ChatHeader
          isAccountPanelOpen={true}
          isSidebarCollapsed={false}
          isSidebarOpen={false}
          onMenuClick={() => {}}
          onToggleAccountPanel={() => {}}
          title="Test Title"
          user={dummyUser}
        />,
      );

      expect(html).toContain('aria-controls="right-account-panel"');
      expect(html).toContain('aria-expanded="true"');
      expect(html).toContain('aria-label="Close Google Account details"');
      expect(html).toContain("border-[#315F85]");
      expect(html).toContain("bg-[#F1F5F9]");
    });
  });

  describe("Sidebar Collapse & Expansion", () => {
    it("renders full expanded sidebar with header collapse button and id", () => {
      const html = renderToString(
        <Sidebar
          account="personal"
          accounts={dummyAccounts}
          activeConversationId="conv-1"
          conversations={dummyConversations}
          isCollapsed={false}
          isOpen={false}
          onAccountChange={() => {}}
          onClose={() => {}}
          onDeleteConversation={() => {}}
          onNewChat={() => {}}
          onRenameConversation={() => {}}
          onSelectConversation={() => {}}
          onToggleCollapse={() => {}}
          user={dummyUser}
        />,
      );

      expect(html).toContain('id="left-sidebar"');
      expect(html).toContain("lg:w-[280px]");
      expect(html).toContain('aria-label="Collapse sidebar"');
      expect(html).toContain('title="Collapse sidebar"');
      expect(html).toContain("AI Assistant");
      expect(html).toContain("Recent chats");
      expect(html).toContain("Project Architecture Discussion");
    });

    it("renders collapsed rail sidebar with expand control and compact width", () => {
      const html = renderToString(
        <Sidebar
          account="personal"
          accounts={dummyAccounts}
          activeConversationId="conv-1"
          conversations={dummyConversations}
          isCollapsed={true}
          isOpen={false}
          onAccountChange={() => {}}
          onClose={() => {}}
          onDeleteConversation={() => {}}
          onNewChat={() => {}}
          onRenameConversation={() => {}}
          onSelectConversation={() => {}}
          onToggleCollapse={() => {}}
          user={dummyUser}
        />,
      );

      expect(html).toContain('id="left-sidebar"');
      expect(html).toContain("lg:w-[72px]");
      expect(html).toContain('aria-label="Expand sidebar"');
      expect(html).toContain('title="Expand sidebar"');
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain('aria-label="New chat"');
      expect(html).toContain('aria-current="page"');
      expect(html).toContain('id="history-heading">...</h2>');
    });

    it("renders mobile backdrop with accessible label", () => {
      const html = renderToString(
        <Sidebar
          account="personal"
          accounts={dummyAccounts}
          activeConversationId={null}
          conversations={[]}
          isCollapsed={false}
          isOpen={true}
          onAccountChange={() => {}}
          onClose={() => {}}
          onDeleteConversation={() => {}}
          onNewChat={() => {}}
          onRenameConversation={() => {}}
          onSelectConversation={() => {}}
          onToggleCollapse={() => {}}
          user={dummyUser}
        />,
      );

      expect(html).toContain('aria-label="Close navigation overlay"');
      expect(html).toContain("opacity-100");
    });
  });

  describe("RightAccountPanel Visibility & Controls", () => {
    it("renders desktop panel with visible close button when isOpen is true", () => {
      const html = renderToString(
        <RightAccountPanel
          accounts={dummyAccounts}
          activeAccountLabel="personal"
          isOpen={true}
          onClose={() => {}}
          onOpenManageAccounts={() => {}}
        />,
      );

      expect(html).toContain('id="right-account-panel"');
      expect(html).toContain("w-72");
      expect(html).toContain('aria-label="Close Google Account panel"');
      expect(html).toContain('title="Close Google Account panel"');
      // Close button should NOT be restricted to lg:hidden
      expect(html).not.toMatch(/aria-label="Close Google Account panel"[^>]*lg:hidden/);
      expect(html).toContain("Google Account");
      expect(html).toContain("alex@gmail.com");
      expect(html).toContain("Connected");
    });

    it("does NOT render desktop aside when isOpen is false, freeing width for workspace", () => {
      const html = renderToString(
        <RightAccountPanel
          accounts={dummyAccounts}
          activeAccountLabel="personal"
          isOpen={false}
          onClose={() => {}}
          onOpenManageAccounts={() => {}}
        />,
      );

      // Desktop aside should not be in the output when closed
      expect(html).not.toContain('id="right-account-panel"');
      // Mobile drawer should be pointer-events-none hidden
      expect(html).toContain("pointer-events-none hidden");
    });

    it("renders accessible overlay backdrop for drawer", () => {
      const html = renderToString(
        <RightAccountPanel
          accounts={dummyAccounts}
          activeAccountLabel="personal"
          isOpen={true}
          onClose={() => {}}
          onOpenManageAccounts={() => {}}
        />,
      );

      expect(html).toContain('aria-label="Close account panel overlay"');
      expect(html).toContain('id="right-account-drawer"');
    });
  });

  describe("Independent State Scenarios", () => {
    it("supports both sidebars closed simultaneously", () => {
      const leftHtml = renderToString(
        <Sidebar
          account="personal"
          accounts={dummyAccounts}
          activeConversationId={null}
          conversations={[]}
          isCollapsed={true}
          isOpen={false}
          onAccountChange={() => {}}
          onClose={() => {}}
          onDeleteConversation={() => {}}
          onNewChat={() => {}}
          onRenameConversation={() => {}}
          onSelectConversation={() => {}}
          onToggleCollapse={() => {}}
          user={dummyUser}
        />,
      );

      const rightHtml = renderToString(
        <RightAccountPanel
          accounts={dummyAccounts}
          activeAccountLabel="personal"
          isOpen={false}
          onClose={() => {}}
          onOpenManageAccounts={() => {}}
        />,
      );

      const headerHtml = renderToString(
        <ChatHeader
          isAccountPanelOpen={false}
          isSidebarCollapsed={true}
          isSidebarOpen={false}
          onMenuClick={() => {}}
          onToggleAccountPanel={() => {}}
          title="Full Width Workspace"
          user={dummyUser}
        />,
      );

      // Left sidebar is collapsed to 72px rail
      expect(leftHtml).toContain("lg:w-[72px]");
      // Right sidebar is completely absent on desktop
      expect(rightHtml).not.toContain('id="right-account-panel"');
      // Top header has reopen controls for BOTH sidebars
      expect(headerHtml).toContain('aria-label="Expand sidebar"');
      expect(headerHtml).toContain('aria-label="Open Google Account details"');
    });

    it("supports left expanded while right is open", () => {
      const leftHtml = renderToString(
        <Sidebar
          account="personal"
          accounts={dummyAccounts}
          activeConversationId={null}
          conversations={[]}
          isCollapsed={false}
          isOpen={false}
          onAccountChange={() => {}}
          onClose={() => {}}
          onDeleteConversation={() => {}}
          onNewChat={() => {}}
          onRenameConversation={() => {}}
          onSelectConversation={() => {}}
          onToggleCollapse={() => {}}
          user={dummyUser}
        />,
      );

      const rightHtml = renderToString(
        <RightAccountPanel
          accounts={dummyAccounts}
          activeAccountLabel="personal"
          isOpen={true}
          onClose={() => {}}
          onOpenManageAccounts={() => {}}
        />,
      );

      expect(leftHtml).toContain("lg:w-[280px]");
      expect(rightHtml).toContain('id="right-account-panel"');
      expect(rightHtml).toContain("w-72");
    });
  });
});
