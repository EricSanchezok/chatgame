import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

export function ManagementShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="cg-management">
      <header className="cg-management__header">
        <Link className="cg-back-link" href="/">
          <ArrowLeft aria-hidden="true" size={18} />
          主菜单
        </Link>
        <p className="cg-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {children}
    </main>
  );
}
