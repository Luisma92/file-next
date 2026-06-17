/**
 * Tests for `<ErrorState />`.
 *
 * Verifies:
 *   - Renders error code and message.
 *   - role="alert" present.
 *   - Optional retry button calls onRetry.
 *   - Renders without onRetry (no retry button shown).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorState } from "@/components/file-next/error-state";

describe("<ErrorState />", () => {
  it("renders the error code and message", () => {
    render(
      <ErrorState
        error={{
          code: "NetworkError",
          message: "Connection timed out",
        }}
      />,
    );
    expect(screen.getByText(/networkerror/i)).toBeInTheDocument();
    expect(screen.getByText(/connection timed out/i)).toBeInTheDocument();
  });

  it("has role=alert", () => {
    render(<ErrorState error={{ code: "X", message: "Y" }} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders a Retry button when onRetry is provided", () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        error={{ code: "NetworkError", message: "boom" }}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("does not render a Retry button when onRetry is omitted", () => {
    render(<ErrorState error={{ code: "NetworkError", message: "boom" }} />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });
});
