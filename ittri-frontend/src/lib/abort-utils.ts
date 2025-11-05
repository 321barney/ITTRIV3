// Centralized "is this an abort?" detection across browsers/runtimes
export function isAbortLike(err: any): boolean {
  const msg = err?.message ?? err?.reason ?? err;
  return (
    err?.name === "AbortError" ||
    err?.code === 20 || // old DOMException
    typeof msg === "string" && msg.toLowerCase().includes("abort") ||
    err?.cause?.name === "AbortError" ||
    err?.cause?.code === 20 ||
    typeof err?.cause?.message === "string" && err.cause.message.toLowerCase().includes("abort") ||
    err === "unmount" || err?.reason === "unmount" ||
    err === "refresh" || err?.reason === "refresh"
  );
}
