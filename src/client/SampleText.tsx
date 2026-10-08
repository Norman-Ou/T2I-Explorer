import type { ReactNode } from "react";
import type { SampleView } from "../shared/contracts.js";
export function ColoredText({ value }: {
    value: string | null | undefined;
}) {
    if (value === null || value === undefined)
        return <span className="empty-text">Unavailable</span>;
    if (value === "")
        return <span className="empty-text">(exact empty string)</span>;
    const parts: ReactNode[] = [];
    let cursor = 0;
    // These are model-output tokens, not HTML. Keep every character literal.
    for (const match of value.matchAll(/<p>(?:(?!<p>|<\/p>)[\s\S])*<\/p>/g)) {
        parts.push(value.slice(cursor, match.index));
        const token = match[0];
        const color = token.match(/<color>\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)<\/color>/);
        const rgb = color?.slice(1).map(Number);
        if (rgb && rgb.every(channel => channel <= 255)) {
            const linear = rgb.map(channel => { const s = channel / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
            const luminance = 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
            parts.push(<span className="colored-object" key={match.index} style={{ color: `rgb(${rgb.join(", ")})`, backgroundColor: luminance > 0.179 ? "#000" : "#fff" }}>{token}</span>);
        }
        else
            parts.push(token);
        cursor = match.index + token.length;
    }
    parts.push(value.slice(cursor));
    return <>{parts}</>;
}
export function SampleText({ record }: {
    record: SampleView;
}) {
    const fields: Array<[
        string,
        string | null
    ]> = [
        ["Input text", record.input_text],
        ["Pred text", record.pred_text],
        ["GT text", record.gt_text],
        ...(record.extra_texts ?? []).map(item => [item.title, item.text] as [
            string,
            string | null
        ])
    ];
    return <>{fields.map(([label, value], index) => <section key={`${label}-${index}`}>
    <h2>{label}</h2><p className="exact-text"><ColoredText value={value}/></p>
  </section>)}</>;
}
