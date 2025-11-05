// src/utils/hush-tty.ts
// Prevent Node from crashing on TTY EIO errors that can happen during watch restarts
// (common on Replit/containers when stdin gets detached briefly).

try {
  const swallow = (e: any) => {
    if (!e) return;
    // Ignore transient I/O errors produced by TTY streams on restarts
    if (e.code === 'EIO' || e.syscall === 'read' || /EIO/i.test(String(e.message))) {
      return;
    }
    // re-throw any other errors
    throw e;
  };

  if (process.stdin?.on) process.stdin.on('error', swallow);
  if (process.stdout?.on) process.stdout.on('error', swallow);
  if (process.stderr?.on) process.stderr.on('error', swallow);
} catch {
  // best-effort only
}
