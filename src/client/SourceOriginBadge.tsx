import { Database, GitBranch } from "lucide-react";
import type { DataOrigin } from "../shared/contracts.js";
export function SourceOriginBadge({ origin = "native" }: {
    origin?: DataOrigin;
}) {
    const label = origin === "derived" ? "衍生" : "原生";
    const Icon = origin === "derived" ? GitBranch : Database;
    return <span className={`source-origin ${origin}`} role="img" aria-label={label} title={label}>
    <Icon size={16} aria-hidden="true"/>
  </span>;
}
