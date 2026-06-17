/**
 * Tests for `<EmptyState />`.
 *
 * Verifies:
 *   - Renders title + description + optional action.
 *   - Has role="status" + aria-live="polite".
 *   - Custom icon replaces the default Inbox.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Star } from "lucide-react";
import { EmptyState } from "@/components/file-next/empty-state";

describe("<EmptyState />", () => {
  it("renders title, description, and action", () => {
    render(
      <EmptyState
        title="No files yet"
        description="Upload a file to get started."
        action={<button type="button">Upload</button>}
      />,
    );
    expect(screen.getByText("No files yet")).toBeInTheDocument();
    expect(screen.getByText(/upload a file/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload/i })).toBeInTheDocument();
  });

  it("has role=status and aria-live=polite", () => {
    render(<EmptyState title="Nothing here" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("uses a custom icon when provided", () => {
    render(
      <EmptyState
        title="Starred files"
        icon={<Star aria-label="star-icon" data-testid="custom-icon" />}
      />,
    );
    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });

  it("renders without a description when description is omitted", () => {
    render(<EmptyState title="Just a title" />);
    expect(screen.getByText("Just a title")).toBeInTheDocument();
  });
});
