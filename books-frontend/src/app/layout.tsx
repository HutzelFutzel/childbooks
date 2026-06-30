import type { Metadata } from "next";
import "./globals.css";
import { AnalyticsInit } from "../ui/components/AnalyticsInit";

export const metadata: Metadata = {
  title: {
    default: "Childbook Studio — AI-illustrated children's books",
    template: "%s · Childbook Studio",
  },
  description:
    "Write, illustrate, and print custom children's picture books with AI. Consistent characters, beautiful layouts, and print-ready export.",
  openGraph: {
    title: "Childbook Studio",
    description:
      "Write, illustrate, and print custom children's picture books with AI.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <AnalyticsInit />
      </body>
    </html>
  );
}
