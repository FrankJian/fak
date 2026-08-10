import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { Popover } from "./Popover";

function Fixture({ onClose }: { onClose: () => void }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef} type="button">
        Trigger
      </button>
      <Popover open anchorRef={anchorRef} ariaLabel="Options" onClose={onClose}>
        <button type="button">Option</button>
      </Popover>
    </>
  );
}

describe("Popover", () => {
  it("closes when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "Options" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when the pointer moves outside the anchor and popover", () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);

    fireEvent.pointerDown(document.body);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
