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
          borderRadius: "1rem",
          fontFamily: "var(--font-sans)",
          boxShadow: "var(--shadow-lifted)",
        },
      }}
    />
  );
}
