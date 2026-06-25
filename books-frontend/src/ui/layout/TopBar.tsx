import { BookOpen, Settings } from "lucide-react";
import { Button } from "../components/Button";

export interface TopBarProps {
  onOpenSettings: () => void;
  /** Optional center / breadcrumb slot. */
  center?: React.ReactNode;
  left?: React.ReactNode;
}

export function TopBar({ onOpenSettings, center, left }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-ink-100 bg-white/80 px-5 backdrop-blur-md">
      <div className="flex items-center gap-3">
        {left}
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-soft">
            <BookOpen className="size-5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold text-ink-900">Childbook Studio</p>
            <p className="text-[11px] text-ink-400">AI picture-book generator</p>
          </div>
        </div>
      </div>

      <div className="hidden md:block">{center}</div>

      <Button variant="ghost" size="sm" leftIcon={<Settings className="size-4" />} onClick={onOpenSettings}>
        Settings
      </Button>
    </header>
  );
}
