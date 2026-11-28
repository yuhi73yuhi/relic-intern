import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GrooveLens — グルーヴ可視化",
  description: "楽器演奏の発音タイミングの微細なズレ（グルーヴ）をブラウザだけで解析・可視化する",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
