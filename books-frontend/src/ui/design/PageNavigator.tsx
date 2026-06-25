import type { DesignPage } from "./designInit";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { cn } from "../lib/cn";

export function PageNavigator({
  pages,
  currentId,
  onSelect,
}: {
  pages: DesignPage[];
  currentId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {pages.map((p) => (
        <Thumb key={p.id} page={p} active={p.id === currentId} onClick={() => onSelect(p.id)} />
      ))}
    </div>
  );
}

function Thumb({ page, active, onClick }: { page: DesignPage; active: boolean; onClick: () => void }) {
  const url = useBlobUrl(page.blobId);
  return (
    <button onClick={onClick} className="flex shrink-0 flex-col items-center gap-1">
      <div
        className={cn(
          "relative overflow-hidden rounded-lg ring-2 transition",
          active ? "ring-brand-500" : "ring-transparent hover:ring-ink-200",
        )}
        style={{ width: 64 * page.aspect, height: 64 }}
      >
        {url ? (
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center bg-ink-100 text-[10px] text-ink-400">
            {page.isCover ? "cover" : "no art"}
          </div>
        )}
      </div>
      <span className={cn("max-w-[80px] truncate text-[10px]", active ? "text-brand-600" : "text-ink-400")}>
        {page.label}
      </span>
    </button>
  );
}
