import { Icon, type IconName } from "@/components/ui/icons";

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
        <div className="mb-8 sm:mb-9">
          <div className="mb-5 flex size-10 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600"><Icon className="size-5" name="spark" /></div>
          <p className="text-sm font-medium text-blue-600">Good to see you.</p>
          <h1 className="mt-2 max-w-xl text-4xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-5xl">What can I help you with?</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-slate-500 sm:text-base">A calm, capable space for staying organized, informed, and moving forward.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {prompts.map((prompt) => (
            <button className="group flex min-h-[116px] items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-[0_1px_2px_rgb(15_23_42_/_0.03)] transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-100/40 focus:outline-none focus:ring-4 focus:ring-blue-100" key={prompt.label} onClick={() => onPromptSelect(prompt.label)} type="button">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-blue-600 transition group-hover:bg-blue-50"><Icon name={prompt.icon} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{prompt.eyebrow}</span>
                <span className="mt-1 block text-sm font-semibold text-slate-800">{prompt.label}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-400">{prompt.description}</span>
              </span>
              <Icon className="ml-auto mt-1 size-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-500" name="chevron-right" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
