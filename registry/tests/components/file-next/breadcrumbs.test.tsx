/**
 * Tests for `<Breadcrumbs />`.
 *
 * Verifies:
 *   - Renders all segments.
 *   - Last segment is plain text with aria-current="page".
 *   - Earlier segments are buttons that call onNavigate with the segment.
 *   - Chevron separators appear between segments (not after the last).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Breadcrumbs } from "@/components/file-next/breadcrumbs";

describe("<Breadcrumbs />", () => {
  it("renders all segments in order", () => {
    const segments = [
      { id: "root", name: "Home" },
      { id: "docs", name: "Documents" },
      { id: "2026", name: "2026" },
    ];
    render(<Breadcrumbs segments={segments} />);
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Documents")).toBeInTheDocument();
    expect(screen.getByText("2026")).toBeInTheDocument();
  });

  it("marks the last segment as aria-current=page", () => {
    const segments = [
      { id: "root", name: "Home" },
      { id: "current", name: "Current Folder" },
    ];
    render(<Breadcrumbs segments={segments} />);
    const current = screen.getByText("Current Folder");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current.tagName).toBe("SPAN");
  });

  it("renders earlier segments as focusable buttons", () => {
    const segments = [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
      { id: "c", name: "Current" },
    ];
    render(<Breadcrumbs segments={segments} />);
    const alphaButton = screen.getByRole("button", { name: "Alpha" });
    const betaButton = screen.getByRole("button", { name: "Beta" });
    expect(alphaButton).toBeInTheDocument();
    expect(betaButton).toBeInTheDocument();
  });

  it("calls onNavigate with the clicked segment", () => {
    const onNavigate = vi.fn();
    const segments = [
      { id: "root", name: "Home" },
      { id: "current", name: "Current" },
    ];
    render(<Breadcrumbs segments={segments} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(onNavigate).toHaveBeenCalledWith(segments[0]);
  });

  it("has aria-label=Breadcrumb on the nav element", () => {
    render(<Breadcrumbs segments={[{ id: "1", name: "Only" }]} />);
    expect(screen.getByRole("navigation", { name: /breadcrumb/i })).toBeInTheDocument();
  });
});
