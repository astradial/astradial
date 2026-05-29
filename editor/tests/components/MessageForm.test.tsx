import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MessagesForm from "@/components/inspector/forms/MessagesForm";
import type { MessageJson } from "@/lib/schema/flow.schema";

describe("MessagesForm", () => {
  const baseMessage: MessageJson = { role: "system", content: "Hello" };

  it("renders the provided label and message content", () => {
    const onChange = vi.fn();
    render(<MessagesForm label="System" messages={[baseMessage]} onChange={onChange} />);

    expect(screen.getAllByText("System")[0]).toBeInTheDocument();
    expect(screen.getByDisplayValue("Hello")).toBeInTheDocument();
  });

  it("emits updated content when the textarea changes", () => {
    const onChange = vi.fn();
    render(<MessagesForm label="System" messages={[baseMessage]} onChange={onChange} />);

    const textarea = screen.getByDisplayValue("Hello");
    fireEvent.change(textarea, { target: { value: "Updated" } });

    expect(onChange).toHaveBeenCalledWith([{ ...baseMessage, content: "Updated" }]);
  });

  it("adds a default message when clicking Add", () => {
    const onChange = vi.fn();
    render(<MessagesForm label="System" messages={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /add/i }));

    expect(onChange).toHaveBeenCalledWith([{ role: "system", content: "" }]);
  });
});
