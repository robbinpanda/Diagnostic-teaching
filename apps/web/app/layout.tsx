import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "诊断式数学答疑 MVP",
  description: "面向初高中数学题的诊断式答疑 demo"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
