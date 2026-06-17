/**
 * Tests for the `useUploader` hook.
 *
 * Scenarios (from spec `headless#2` — uploader):
 *   - The hook must upload via XHR with real progress events.
 *   - The hook must expose a `cancel()` that aborts the in-flight XHR.
 *   - State machine: idle → uploading → (success | error | aborted).
 *   - Errors surface as `FileSystemError`.
 *
 * The XHR is stubbed via `vi.stubGlobal('XMLHttpRequest', MyStub)` in
 * `beforeEach`. The stub captures the `progress` listener on `upload`,
 * the `load`/`error` listeners on the XHR itself, and exposes
 * `__triggerProgress(loaded, total)`, `__triggerLoad()`, `__triggerError()`
 * to advance the state machine from the test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUploader } from "@/use-uploader";
import { FileSystemError } from "file-next";

// ---------------------------------------------------------------------------
// XHR stub
// ---------------------------------------------------------------------------

type ProgressListener = (event: { lengthComputable: boolean; loaded: number; total: number }) => void;
type LoadListener = () => void;
type ErrorListener = () => void;

class StubXHR {
  public upload: {
    addEventListener: (type: "progress", cb: ProgressListener) => void;
  };
  public method: string | null = null;
  public url: string | null = null;
  public headers: Record<string, string> = {};
  public body: unknown = null;
  public aborted = false;

  private progressListener: ProgressListener | null = null;
  private loadListener: LoadListener | null = null;
  private errorListener: ErrorListener | null = null;

  constructor() {
    this.upload = {
      addEventListener: (_type: "progress", cb: ProgressListener) => {
        this.progressListener = cb;
      },
    };
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key] = value;
  }

  send(body: unknown): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
  }

  addEventListener(type: "load" | "error", cb: LoadListener | ErrorListener): void {
    if (type === "load") this.loadListener = cb as LoadListener;
    else if (type === "error") this.errorListener = cb as ErrorListener;
  }

  // --- test triggers ---
  __triggerProgress(loaded: number, total: number): void {
    if (!this.progressListener) {
      throw new Error("no progress listener registered");
    }
    this.progressListener({ lengthComputable: total > 0, loaded, total });
  }

  __triggerLoad(): void {
    if (!this.loadListener) throw new Error("no load listener registered");
    this.loadListener();
  }

  __triggerError(): void {
    if (!this.errorListener) throw new Error("no error listener registered");
    this.errorListener();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeFile = (
  overrides: Partial<{ name: string; size: number; type: string; content: Blob }> = {},
) => ({
  name: "test.txt",
  size: 100,
  type: "text/plain",
  content: new Blob(["hello"], { type: "text/plain" }),
  ...overrides,
});

type TestFile = ReturnType<typeof makeFile>;

const renderUploader = (
  uploadUrl: string,
  confirmUpload?: (xhr: XMLHttpRequest, file: unknown) => void,
) =>
  renderHook(() =>
    useUploader({ uploadUrl, confirmUpload: confirmUpload as never }),
  );

let lastXHR: StubXHR | null = null;

beforeEach(() => {
  lastXHR = null;
  const TrackingStub = class extends StubXHR {
    constructor() {
      super();
      lastXHR = this;
    }
  };
  vi.stubGlobal("XMLHttpRequest", TrackingStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useUploader — spec headless#2", () => {
  it("starts in the idle state with progress=0 and no error", () => {
    const { result } = renderUploader("/api/upload");
    expect(result.current.status).toBe("idle");
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.upload).toBe("function");
    expect(typeof result.current.cancel).toBe("function");
  });

  it("open()s a POST to uploadUrl and send()s the file when upload() is called", () => {
    const { result } = renderUploader("/api/upload");
    const file: TestFile = makeFile({ name: "photo.png", size: 42, type: "image/png" });

    act(() => {
      result.current.upload(file);
    });

    expect(lastXHR).not.toBeNull();
    expect(lastXHR!.method).toBe("POST");
    expect(lastXHR!.url).toBe("/api/upload");
    expect(lastXHR!.body).toBe(file);
    expect(result.current.status).toBe("uploading");
    expect(result.current.progress).toBe(0);
  });

  it("updates progress from a synthetic progress event (loaded=50, total=100)", () => {
    const { result } = renderUploader("/api/upload");
    act(() => {
      result.current.upload(makeFile());
    });

    act(() => {
      lastXHR!.__triggerProgress(50, 100);
    });

    expect(result.current.progress).toBe(50);
    expect(result.current.status).toBe("uploading");
  });

  it("transitions to success when load fires after a 100% progress event", () => {
    const { result } = renderUploader("/api/upload");
    act(() => {
      result.current.upload(makeFile());
    });

    act(() => {
      lastXHR!.__triggerProgress(100, 100);
    });
    expect(result.current.progress).toBe(100);

    act(() => {
      lastXHR!.__triggerLoad();
    });

    expect(result.current.status).toBe("success");
    expect(result.current.progress).toBe(100);
    expect(result.current.error).toBeNull();
  });

  it("transitions to error and surfaces a FileSystemError when error fires", () => {
    const { result } = renderUploader("/api/upload");
    act(() => {
      result.current.upload(makeFile());
    });

    act(() => {
      lastXHR!.__triggerError();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBeInstanceOf(FileSystemError);
    expect(result.current.error?.code).toBe("NetworkError");
  });

  it("cancel() during uploading transitions to aborted and calls XHR.abort()", () => {
    const confirmUpload = vi.fn();
    const { result } = renderUploader("/api/upload", confirmUpload);
    act(() => {
      result.current.upload(makeFile());
    });
    expect(result.current.status).toBe("uploading");

    act(() => {
      result.current.cancel();
    });

    expect(result.current.status).toBe("aborted");
    expect(lastXHR!.aborted).toBe(true);
    // No confirmUpload callback should fire after cancel.
    expect(confirmUpload).not.toHaveBeenCalled();
  });
});
