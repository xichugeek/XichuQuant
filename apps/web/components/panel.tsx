import type { ReactNode } from "react";

type PanelProps = {
  children: ReactNode;
  description?: string;
  title: string;
  trailing?: ReactNode;
};

export function Panel({ children, description, title, trailing }: PanelProps) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {trailing}
      </div>
      {children}
    </section>
  );
}
