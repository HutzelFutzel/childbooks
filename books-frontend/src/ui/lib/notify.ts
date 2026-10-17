import { toast } from "sonner";
import { describeError, isAbortError } from "../../core/errors";
import { clientLog } from "../../platform/clientLogger";

export const notify = {
  success: (message: string, description?: string) =>
    toast.success(message, { description }),
  info: (message: string, description?: string) => toast(message, { description }),
  warning: (message: string, description?: string) => toast.warning(message, { description }),
  errorWithDescription: (message: string, description?: string) => {
    clientLog.error({
      domain: "studio",
      event: "ui.error_toast",
      message: description ? `${message}: ${description}` : message,
    });
    return toast.error(message, { description });
  },
  error: (err: unknown, fallback = "Something went wrong") => {
    const message = err ? describeError(err) : fallback;
    if (!isAbortError(err)) {
      clientLog.error({
        domain: "studio",
        event: "ui.error_toast",
        message,
        error: err,
      });
    }
    toast.error(message);
  },
  promise: toast.promise,
};

export { toast };
