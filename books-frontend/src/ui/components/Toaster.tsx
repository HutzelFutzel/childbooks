import { Toaster as SonnerToaster } from "sonner";

/** App-wide toast host. Rendered once near the root. */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        style: {
          borderRadius: "0.875rem",
          fontFamily: "var(--font-sans)",
        },
      }}
    />
  );
}
