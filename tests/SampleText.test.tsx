import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SampleView } from "../src/shared/contracts.js";
import { ColoredText, SampleText } from "../src/client/SampleText.js";
afterEach(cleanup);
const record: SampleView = {
    sample_id: "sample", index: 1, input_text: "Input only", pred_text: "Prediction only", gt_text: "GT only", panels: [], metadata: {}
};
describe("sample text", () => {
    it("shows separate input, prediction and ground truth without swapping them", () => {
        render(<SampleText record={record}/>);
        for (const title of ["Input text", "Pred text", "GT text"])
            expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
        expect(screen.getByText("Input only")).toBeInTheDocument();
        expect(screen.getByText("Prediction only")).toBeInTheDocument();
        expect(screen.getByText("GT only")).toBeInTheDocument();
    });
    it("keeps missing GT and an exact empty prediction distinct", () => {
        render(<SampleText record={{ ...record, pred_text: "", gt_text: null }}/>);
        expect(screen.getByText("(exact empty string)")).toBeInTheDocument();
        expect(screen.getByText("Unavailable")).toBeInTheDocument();
    });
    it("preserves literal tags and whitespace while coloring whole object spans independently", () => {
        const pink = "<p>airplane-3<color>(254, 91, 109)</color></p>";
        const green = "<p>tree<color>(0, 128, 0)</color></p>";
        const text = `Before  ${pink}\n${green} after <SEG>`;
        const { container } = render(<ColoredText value={text}/>);
        expect(container.textContent).toBe(text);
        expect(screen.getByText(pink)).toHaveStyle({ color: "rgb(254, 91, 109)" });
        expect(screen.getByText(green)).toHaveStyle({ color: "rgb(0, 128, 0)" });
        expect(container.querySelector("p, color, seg")).toBeNull();
    });
    it("keeps white text white on a dark background", () => {
        const text = "<p>cloud<color>(255,255,255)</color></p>";
        render(<ColoredText value={text}/>);
        expect(screen.getByText(text)).toHaveStyle({ color: "rgb(255, 255, 255)", backgroundColor: "rgb(0, 0, 0)" });
    });
    it.each(["<p>x<color>(256,0,0)</color></p>", "<p>x<color>(-1,0,0)</color></p>", "<p>x<color>(1.5,0,0)</color></p>", "<p>x<color>(R,G,B)</color></p>", "<p>x<color>(1,2,3)</color>"])("leaves malformed color markup unchanged: %s", (text) => {
        const { container } = render(<ColoredText value={text}/>);
        expect(container.textContent).toBe(text);
        expect(container.querySelector(".colored-object")).toBeNull();
    });
    it("treats HTML and event handlers as text", () => {
        const text = '<p><img src=x onerror="alert(1)"><color>(1,2,3)</color></p><script>alert(1)</script>';
        const { container } = render(<ColoredText value={text}/>);
        expect(container.textContent).toBe(text);
        expect(container.querySelector("img, script")).toBeNull();
    });
});
