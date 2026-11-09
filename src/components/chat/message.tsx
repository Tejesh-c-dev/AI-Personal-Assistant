import { Icon } from "@/components/ui/icons";

type MessageProps = {
  role: "user" | "assistant";
  content: string;
};

export function Message({ role, content }: MessageProps) {
  const isUser = role === "user";

  return (
    <article className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Icon className="size-3.5" name="spark" /></div>}
      <div className={`max-w-[min(80%,680px)] rounded-2xl px-4 py-3 text-sm leading-6 ${isUser ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700"}`}>{content}</div>
    </article>
  );
}

export function LoadingState() {
  return <div aria-label="Assistant is thinking" className="flex items-center gap-2 text-xs text-slate-400"><span className="size-2 animate-pulse rounded-full bg-blue-500" /><span>Thinking through that...</span></div>;
}

type ErrorStateProps = { message?: string };

export function ErrorState({ message = "Something went wrong. Please try again." }: ErrorStateProps) {
  return <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>;
}
