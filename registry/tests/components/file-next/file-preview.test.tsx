/**
 * Tests for `<FilePreview />`.
 *
 * Verifies:
 *   - Image MIME type + URL renders an <img>.
 *   - Image MIME type without URL renders an icon placeholder.
 *   - Non-image MIME type renders a file icon with aria-label.
 *   - The icon's aria-label includes the MIME type.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FilePreview } from "@/components/file-next/file-preview";

describe("<FilePreview />", () => {
  it("renders an img when mimeType is image/* and url is provided", () => {
    render(
      <FilePreview
        mimeType="image/png"
        url="https://example.com/cat.png"
        alt="A cat"
      />,
    );
    const img = screen.getByRole("img", { name: /a cat/i });
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "https://example.com/cat.png");
  });

  it("renders a placeholder when mimeType is image/* but url is missing", () => {
    render(<FilePreview mimeType="image/png" alt="missing" />);
    const placeholder = screen.getByRole("img", { name: /missing/i });
    expect(placeholder.tagName).toBe("DIV");
  });

  it("renders a file icon for non-image MIME types with aria-label", () => {
    render(
      <FilePreview
        mimeType="application/pdf"
        alt="Annual report"
      />,
    );
    const icon = screen.getByRole("img", { name: /annual report/i });
    expect(icon.tagName).toBe("DIV");
    expect(icon).toHaveTextContent("");
  });

  it("falls back to a generic label when alt is omitted", () => {
    render(<FilePreview mimeType="application/pdf" />);
    expect(screen.getByRole("img", { name: /application\/pdf preview/i })).toBeInTheDocument();
  });
});
