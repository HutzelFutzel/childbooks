import { toast } from "sonner";
import { describeError } from "../../core/errors";

export const notify = {
  success: (message: string, description?: string) =>
    toast.success(message, { description }),
  info: (message: string, description?: string) => toast(message, { description }),
  error: (err: unknown, fallback = "Something went wrong") => {
    const message = err ? describeError(err) : fallback;
    toast.error(message);
  },
  promise: toast.promise,
};

export { toast };
