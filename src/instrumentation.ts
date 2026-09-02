/**
 * Runs once when the server starts, before it takes any traffic.
 *
 * Its job here is to stop a stray error in a background promise from taking the
 * whole app down. Several writes deliberately fire work that the request does
 * not wait on — publishing a realtime notification, sending a push — and an
 * unhandled rejection from one of those is a crash in current Node, not a
 * warning. A tablet going blank because a notification failed is a far worse
 * outcome than the notification failing.
 */
export async function register() {
  /* Runs in the edge runtime too, where `process` handlers do not apply. */
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason)
  })

  /**
   * An uncaught exception leaves the process in an unknown state, so this logs
   * and lets it go down rather than serving orders from a server that may be
   * half-broken. Railway restarts it in seconds; the alternative is a process
   * that looks healthy and quietly misbehaves.
   */
  process.on('uncaughtException', (error) => {
    console.error('[uncaughtException]', error)
    /* Give the log a tick to flush before the process ends. */
    setTimeout(() => process.exit(1), 100)
  })

  console.log('[instrumentation] process error handlers installed')
}
