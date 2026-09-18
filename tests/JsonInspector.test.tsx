import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { JsonInspector } from "../src/client/JsonInspector.js";

describe("JsonInspector", () => {
  it("renders scalars as text and exposes nested unknown fields", async () => {
    const user = userEvent.setup();
    render(<JsonInspector record={{ prompt: "<script>alert(1)</script>", nested: { value: null, list: [true, 4] } }} />);
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    await user.click(screen.getByRole("button", { name: /nested/ }));
    expect(screen.getAllByText("null")).toHaveLength(2);
    expect(screen.getAllByText("2 items")).toHaveLength(2);
  });
});
