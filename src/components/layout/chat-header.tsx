import { Icon } from "@/components/ui/icons";

type ChatHeaderProps = {
  onMenuClick: () => void;
  isSidebarCollapsed: boolean;
};

export function ChatHeader({ onMenuClick, isSidebarCollapsed }: ChatHeaderProps) {
  return (
    <header className="h-[72px] shrink-0 border-b border-slate-200/70 px-5 sm:px-8">
      <div className="mx-auto flex h-full w-full max-w-4xl items-center justify-between">
        <div className="flex items-center gap-3">
          <button aria-label="Open navigation" className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 shadow-sm hover:text-slate-800 lg:hidden" onClick={onMenuClick} type="button"><Icon className="size-5" name="menu" /></button>
          <div>
            <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-500" /><p className="text-sm font-semibold text-slate-800">New conversation</p></div>
            <p className="mt-0.5 text-xs text-slate-400">Your private workspace</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs font-medium text-slate-400 sm:block">Local workspace</span>
          <button aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} className="hidden rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 lg:block" onClick={onMenuClick} type="button"><Icon name="panel" /></button>
        </div>
      </div>
    </header>
  );
}
