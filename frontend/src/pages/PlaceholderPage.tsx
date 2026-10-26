import type { ReactNode } from "react";
import { Construction } from "lucide-react";
import { Card, PageHeader } from "../components/ui";

export function PlaceholderPage({ title, description, items }: { title: string; description: string; items: ReactNode[] }) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <Card>
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-600">
            <Construction aria-hidden className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Scheduled for the next build phase</h2>
            <p className="mt-1 text-sm text-slate-500">
              The navigation, role protection and API plumbing for this module are in place. The page below will be
              wired to its endpoints next:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
              {items.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
