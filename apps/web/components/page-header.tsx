import type { ReactNode } from "react";

type PageHeaderProps = {
  action?: ReactNode;
  description: string;
  title: string;
};

export function PageHeader({ action, description, title }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
