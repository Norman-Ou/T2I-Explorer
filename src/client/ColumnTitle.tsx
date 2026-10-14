import type { DataOrigin } from "../shared/contracts.js";
import { SourceOriginBadge } from "./SourceOriginBadge.js";

export function ColumnTitle({ task, source, experiment, origin, children }: {
    task: string;
    source: string;
    experiment: string;
    origin?: DataOrigin;
    children?: React.ReactNode;
}) {
    const title = [task, source, experiment].filter(Boolean).join("-");
    return <div className="column-title"><SourceOriginBadge origin={origin}/><strong title={title}>{title}</strong>{children}</div>;
}
