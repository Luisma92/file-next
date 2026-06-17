/**
 * Tests for `<FileBrowser />`.
 *
 * The component delegates to `useFileBrowser` from `@file-next/headless`,
 * so we mock the hook to control its state across tests. This lets us
 * verify the component's mapping from hook state to UI independently
 * of the hook's own correctness (which is tested in the headless package).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { asTenantId, asUserId, type FileNode } from "file-next";

// Mock the headless hook. Each test sets the desired return value.
const mockUseFileBrowser = vi.fn();
vi.mock("@file-next/headless", () => ({
  useFileBrowser: (...args: unknown[]) => mockUseFileBrowser(...args),
}));

// Import AFTER the mock so the component picks it up.
import { FileBrowser } from "@/components/file-next/file-browser";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = asTenantId("acme");
const OWNER = asUserId("user-1");
const baseTs = new Date("2026-06-17T12:00:00Z");

const makeFileNode = (overrides: Partial<FileNode> & Pick<FileNode, "id" | "name" | "kind">): FileNode => ({
  id: overrides.id,
  tenantId: TENANT,
  parentId: "root",
  path: `/${overrides.name}`,
  kind: overrides.kind,
  size: 100,
  mimeType: "text/plain",
  s3Key: `tenant/${overrides.name}`,
  ownerId: OWNER,
  metadata: {},
  createdAt: baseTs,
  updatedAt: baseTs,
  deletedAt: null,
  name: overrides.name,
});

const sampleFiles = [
  makeFileNode({ id: "1", name: "alpha.txt", kind: "file" }),
  makeFileNode({ id: "2", name: "beta", kind: "folder" }),
  makeFileNode({ id: "3", name: "gamma.png", kind: "file" }),
];

const defaultListFiles = vi.fn(async () => ({
  ok: true as const,
  value: { items: sampleFiles },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("<FileBrowser />", () => {
  it("renders the loading state with an aria-live region", () => {
    mockUseFileBrowser.mockReturnValue({
      status: "loading",
      files: [],
      error: null,
      refetch: vi.fn(),
    });
    render(
      <FileBrowser listFiles={defaultListFiles} tenantId={TENANT} parentId={null} />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/loading/i);
  });

  it("renders the default empty state when files is empty", () => {
    mockUseFileBrowser.mockReturnValue({
      status: "success",
      files: [],
      error: null,
      refetch: vi.fn(),
    });
    render(
      <FileBrowser listFiles={defaultListFiles} tenantId={TENANT} parentId={null} />,
    );
    expect(screen.getByText(/this folder is empty/i)).toBeInTheDocument();
  });

  it("renders a custom empty state when provided", () => {
    mockUseFileBrowser.mockReturnValue({
      status: "success",
      files: [],
      error: null,
      refetch: vi.fn(),
    });
    render(
      <FileBrowser
        listFiles={defaultListFiles}
        tenantId={TENANT}
        parentId={null}
        emptyState={<div data-testid="custom-empty">No files here yet</div>}
      />,
    );
    expect(screen.getByTestId("custom-empty")).toBeInTheDocument();
  });

  it("renders the default error state with a retry button", () => {
    const refetch = vi.fn();
    mockUseFileBrowser.mockReturnValue({
      status: "error",
      files: [],
      error: { code: "NetworkError", message: "boom", retryable: true, name: "FileSystemError" },
      refetch,
    });
    render(
      <FileBrowser listFiles={defaultListFiles} tenantId={TENANT} parentId={null} />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/networkerror/i);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders the file list with role=listbox and option rows", () => {
    mockUseFileBrowser.mockReturnValue({
      status: "success",
      files: sampleFiles,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <FileBrowser listFiles={defaultListFiles} tenantId={TENANT} parentId={null} />,
    );
    const listbox = screen.getByRole("listbox", { name: /files/i });
    expect(listbox).toBeInTheDocument();
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute("id", "file-row-1");
    expect(options[0]).toHaveTextContent("alpha.txt");
  });

  it("marks the first row as aria-selected initially", () => {
    mockUseFileBrowser.mockReturnValue({
      status: "success",
      files: sampleFiles,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <FileBrowser listFiles={defaultListFiles} tenantId={TENANT} parentId={null} />,
    );
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
    expect(options[2]).toHaveAttribute("aria-selected", "false");
  });

  it("moves selection with ArrowDown and ArrowUp", () => {
    mockUseFileBrowser.mockReturnValue({
      status: "success",
      files: sampleFiles,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <FileBrowser listFiles={defaultListFiles} tenantId={TENANT} parentId={null} />,
    );
    const listbox = screen.getByRole("listbox");
    listbox.focus();
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("Home and End jump to the first and last rows", () => {
    mockUseFileBrowser.mockReturnValue({
      status: "success",
      files: sampleFiles,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <FileBrowser listFiles={defaultListFiles} tenantId={TENANT} parentId={null} />,
    );
    const listbox = screen.getByRole("listbox");
    listbox.focus();
    fireEvent.keyDown(listbox, { key: "End" });
    expect(screen.getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(listbox, { key: "Home" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("Enter activates the active row and invokes onFileClick", () => {
    const onFileClick = vi.fn();
    mockUseFileBrowser.mockReturnValue({
      status: "success",
      files: sampleFiles,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <FileBrowser
        listFiles={defaultListFiles}
        tenantId={TENANT}
        parentId={null}
        onFileClick={onFileClick}
      />,
    );
    const listbox = screen.getByRole("listbox");
    listbox.focus();
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onFileClick).toHaveBeenCalledWith(sampleFiles[1]);
  });

  it("clicking a row invokes onFileClick with that file", () => {
    const onFileClick = vi.fn();
    mockUseFileBrowser.mockReturnValue({
      status: "success",
      files: sampleFiles,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <FileBrowser
        listFiles={defaultListFiles}
        tenantId={TENANT}
        parentId={null}
        onFileClick={onFileClick}
      />,
    );
    fireEvent.click(screen.getByText("gamma.png"));
    expect(onFileClick).toHaveBeenCalledWith(sampleFiles[2]);
  });
});
