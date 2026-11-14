import { Icon, type IconName } from "../ui/icons";

type EmptyStateProps = {
  onPromptSelect: (prompt: string) => void;
};

const prompts: { label: string; description: string; icon: IconName; eyebrow: string }[] = [
  { label: "Email assistant", description: "Summarize, draft, or find what matters in your inbox.", icon: "inbox", eyebrow: "Gmail" },
  { label: "Calendar", description: "Get a clear view of your schedule and next steps.", icon: "calendar", eyebrow: "Planning" },
  { label: "Google Docs", description: "Turn a rough idea into a focused, polished document.", icon: "file", eyebrow: "Create" },
  { label: "Web research", description: "Explore a question with focused, useful research.", icon: "web", eyebrow: "Discover" },
];

export function EmptyState({ onPromptSelect }: EmptyStateProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto py-8 sm:py-10">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-8">
          <div className="mb-4 flex size-10 items-center justify-center rounded-xl border border-[#DCE4ED] bg-[#FFFFFF] text-[#315F85] shadow-xs">
            <Icon className="size-5" name="spark" />
          </div>
          <p className="text-xs font-semibold tracking-wide uppercase text-[#315F85]">
            AI Personal Assistant
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#172B4D] sm:text-4xl">
            What can I help you with today?
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#64748B]">
            A calm, capable enterprise workspace for staying organized, searching your communications, and moving work forward safely.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {prompts.map((prompt) => (
            <button
              className="group flex min-h-[110px] items-start gap-4 rounded-xl border border-[#DCE4ED] bg-[#FFFFFF] p-4 text-left shadow-xs transition hover:border-[#315F85] hover:bg-[#F1F5F9]/50 focus:outline-none focus:ring-2 focus:ring-[#315F85]/20"
              key={prompt.label}
              onClick={() => onPromptSelect(prompt.label)}
              type="button"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#F1F5F9] text-[#315F85] border border-[#DCE4ED] transition group-hover:bg-[#FFFFFF]">
                <Icon name={prompt.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
                  {prompt.eyebrow}
                </span>
                <span className="mt-1 block text-sm font-semibold text-[#172B4D]">
                  {prompt.label}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-[#64748B]">
                  {prompt.description}
                </span>
              </span>
              <Icon
                className="ml-auto mt-1 size-4 text-[#DCE4ED] transition group-hover:translate-x-0.5 group-hover:text-[#315F85]"
                name="chevron-right"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
