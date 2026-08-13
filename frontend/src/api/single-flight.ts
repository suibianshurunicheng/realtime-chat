/**
 * Single-flight: collapses concurrent calls into one in-flight promise.
 * While a call is running, every caller awaits the SAME promise; once it
 * settles (success or failure) the next call starts fresh. Used so that
 * multiple simultaneous 401s trigger exactly one refresh request.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (!inFlight) {
      inFlight = fn().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}
