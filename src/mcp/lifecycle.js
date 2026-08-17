/**
 * Install one shutdown path for every way an MCP stdio process can stop.
 * stdin EOF is the normal path when the owning client process exits.
 */
export function installMcpShutdown({
  stdin = process.stdin,
  processTarget = process,
  cleanupFn,
  exitFn = (code) => process.exit(code),
  logFn = console.error,
} = {}) {
  let shutdownPromise = null;

  const shutdown = (reason) => {
    if (shutdownPromise) return shutdownPromise;

    logFn(`[MCP] Shutting down (${reason})...`);
    shutdownPromise = Promise.resolve()
      .then(() => cleanupFn())
      .then(() => exitFn(0))
      .catch((error) => {
        logFn('[MCP] Shutdown failed:', error);
        exitFn(1);
      });

    return shutdownPromise;
  };

  processTarget.once('SIGINT', () => { void shutdown('SIGINT'); });
  processTarget.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  stdin.once('end', () => { void shutdown('stdin EOF'); });

  return shutdown;
}
