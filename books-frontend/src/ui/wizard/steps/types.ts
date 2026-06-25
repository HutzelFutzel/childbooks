import type { BookConfig } from "../../../core/types";

export interface StepProps {
  config: BookConfig;
  update: (patch: Partial<BookConfig>) => void;
}
