/**
 * Tests for `<FileActions />`.
 *
 * The component delegates to `useFileActions` from `@file-next/headless`,
 * so we mock the hook to control its state across tests. Verifies:
 *   - Trigger button is rendered with correct aria-label.
 *   - Opening the menu shows the 4 items.
 *   - Rename / Move / Copy open their respective dialogs.
 *   - Delete opens an AlertDialog confirmation.
 *   - Confirming delete calls the hook's deleteFile.
 *
 * NOTE: We scope queries to the render container (returned by
 * `render(...)`) because Radix AlertDialog uses a portal that
 * mounts into `document.body`. Without scoping, multiple tests
 * in the same file can see each other's portaled elements.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockDeleteFile = vi.fn();
const mockMoveFile = vi.fn();
const mockCopyFile = vi.fn();

vi.mock("@file-next/headless", () => ({
  useFileActions: () => ({
    deleteFile: mockDeleteFile,
    moveFile: mockMoveFile,
    copyFile: mockCopyFile,
    isPending: false,
    error: null,
  }),
}));

import { FileActions } from "@/components/file-next/file-actions";
import { asTenantId, asUserId, type FileNode } from "file-next";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = asTenantId("acme");
const OWNER = asUserId("user-1");
const baseTs = new Date("2026-06-17T12:00:00Z");

const makeFileNode = (
  overrides: Partial<FileNode> & Pick<FileNode, "id" | "name" | "kind">,
): FileNode => ({
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

const sampleFiles: ReadonlyArray<FileNode> = [
  makeFileNode({ id: "1", name: "alpha.txt", kind: "file" }),
  makeFileNode({ id: "2", name: "beta", kind: "folder" }),
];

const baseProps = {
  file: sampleFiles[0]!,
  files: sampleFiles,
  setFiles: vi.fn(),
  actions: {
    deleteFile: mockDeleteFile,
    moveFile: mockMoveFile,
    copyFile: mockCopyFile,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("<FileActions />", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    mockDeleteFile.mockReset().mockResolvedValue({ ok: true, value: { id: "1" } });
    mockMoveFile.mockReset().mockResolvedValue({ ok: true, value: { id: "1" } });
    mockCopyFile.mockReset().mockResolvedValue({ ok: true, value: { id: "1" } });
  });

  it("renders a trigger button with an aria-label naming the file", () => {
    render(<FileActions {...baseProps} />);
    expect(
      screen.getByRole("button", { name: /actions for alpha\.txt/i }),
    ).toBeInTheDocument();
  });

  it("opens the menu on trigger click and shows the 4 items", async () => {
    render(<FileActions {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /actions for alpha\.txt/i }));
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /rename/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("menuitem", { name: /^move/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^copy/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^delete/i })).toBeInTheDocument();
  });

  it("opens the rename prompt when Rename is selected", async () => {
    render(<FileActions {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /actions for alpha\.txt/i }));
    await user.click(screen.getByRole("menuitem", { name: /rename/i }));
    const dialog = await waitFor(() => {
      const el = document.querySelector('[role="alertdialog"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // Dialog title is a heading — verify by role.
    expect(within(dialog).getByRole("heading", { name: /rename "alpha\.txt"/i })).toBeInTheDocument();
    // The default value is the file's current name.
    expect(within(dialog).getByDisplayValue("alpha.txt")).toBeInTheDocument();
  });

  it("opens the move prompt with a folder-id placeholder when Move is selected", async () => {
    render(<FileActions {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /actions for alpha\.txt/i }));
    await user.click(screen.getByRole("menuitem", { name: /^move/i }));
    const dialog = await waitFor(() => {
      const el = document.querySelector('[role="alertdialog"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(dialog).getByRole("heading", { name: /move "alpha\.txt"/i })).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText(/folder/i)).toBeInTheDocument();
  });

  it("opens the copy prompt when Copy is selected", async () => {
    render(<FileActions {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /actions for alpha\.txt/i }));
    await user.click(screen.getByRole("menuitem", { name: /^copy/i }));
    const dialog = await waitFor(() => {
      const el = document.querySelector('[role="alertdialog"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(dialog).getByRole("heading", { name: /copy "alpha\.txt"/i })).toBeInTheDocument();
  });

  it("opens the delete confirmation when Delete is selected", async () => {
    render(<FileActions {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /actions for alpha\.txt/i }));
    await user.click(screen.getByRole("menuitem", { name: /^delete/i }));
    await waitFor(() => {
      expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    });
    expect(document.body.textContent).toMatch(/cannot be undone/i);
  });

  it("confirming delete calls the hook's deleteFile with the file id", async () => {
    render(<FileActions {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /actions for alpha\.txt/i }));
    await user.click(screen.getByRole("menuitem", { name: /^delete/i }));
    const dialog = await waitFor(() => {
      const el = document.querySelector('[role="alertdialog"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const confirmButton = within(dialog).getByRole("button", { name: /^delete$/i });
    // Use fireEvent (sync) — userEvent awaits animation/transition end
    // events that jsdom never fires, hanging the test indefinitely.
    fireEvent.click(confirmButton);
    await waitFor(() => {
      expect(mockDeleteFile).toHaveBeenCalledWith("1");
    });
  });

  it("confirming move calls the hook's moveFile with the typed destination", async () => {
    render(<FileActions {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /actions for alpha\.txt/i }));
    await user.click(screen.getByRole("menuitem", { name: /^move/i }));
    const dialog = await waitFor(() => {
      const el = document.querySelector('[role="alertdialog"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const input = within(dialog).getByPlaceholderText(/folder/i);
    fireEvent.change(input, { target: { value: "folder-7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^move$/i }));
    await waitFor(() => {
      expect(mockMoveFile).toHaveBeenCalledWith("1", "folder-7");
    });
  });

  it("confirming copy calls the hook's copyFile with the typed destination", async () => {
    render(<FileActions {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /actions for alpha\.txt/i }));
    await user.click(screen.getByRole("menuitem", { name: /^copy/i }));
    const dialog = await waitFor(() => {
      const el = document.querySelector('[role="alertdialog"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const input = within(dialog).getByPlaceholderText(/folder/i);
    fireEvent.change(input, { target: { value: "folder-9" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^copy$/i }));
    await waitFor(() => {
      expect(mockCopyFile).toHaveBeenCalledWith("1", "folder-9");
    });
  });
});
