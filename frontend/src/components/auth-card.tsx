import { pageWrap } from "./ui";

/** The frame every sign-in screen sits in: one column, one card, one heading. */
export function AuthCard({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${pageWrap} flex justify-center py-12`}>
      <div className="w-full max-w-md rounded-[var(--radius-card)] border-2 border-line bg-card p-6 sm:p-8">
        <h1 className="font-display text-3xl leading-tight font-semibold text-plum">
          {title}
        </h1>
        {lede && <p className="mt-3 text-body">{lede}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
