import React, { useState } from "react";

type Props = { title: string; children: React.ReactNode; className?: string };

export default function Tooltip({ title, children, className }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`relative inline-flex items-center ${className || ""}`}>
      <button
        type="button"
        onMouseEnter={()=>setOpen(true)}
        onMouseLeave={()=>setOpen(false)}
        className="ml-2 inline-flex items-center justify-center w-5 h-5 rounded-full border border-border bg-panel text-[11px] leading-none"
        aria-label={`Help: ${title}`}
        title={title}
      >?</button>
      {open && (
        <div className="absolute z-40 top-6 left-0 min-w-[240px] max-w-[320px] bg-[#0F141A] text-[12px] text-[#E6EDF3] border border-[#1F2937] rounded-lg shadow p-3">
          {children}
        </div>
      )}
    </span>
  );
}
