import { once } from 'node:events';

// The native CLI may close a request when its owner is stopped for a handoff.
// Watch the downstream connection separately from errors while reading the provider.
export async function forwardResponse(res, callProvider, observed, timeLimit = 75000) {
  const disconnected = new AbortController();
  const disconnect = () => {
    if (res.writableFinished) return;
    observed.downstreamAbortAt = new Date().toISOString();
    disconnected.abort();
  };
  res.once('close', disconnect);
  const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(timeLimit)]);
  observed.forwardedBytes = 0;
  try {
    const reply = await callProvider(signal);
    observed.upstreamStatus = reply.status;
    observed.upstreamRequest = reply.headers.get('x-request-id') ?? null;
    if (disconnected.signal.aborted) return;
    res.writeHead(reply.status, {'content-type':reply.headers.get('content-type')??'application/json'});
    if (reply.body) {
      for await (const chunk of reply.body) {
        if (disconnected.signal.aborted) return;
        observed.forwardedBytes += chunk.byteLength;
        if (!res.write(chunk)) await once(res, 'drain', {signal});
      }
    }
    observed.upstreamCompleted = true;
    res.end();
  } catch (error) {
    if (!(disconnected.signal.aborted && (error === disconnected.signal.reason || error.name === 'AbortError'))) throw error;
    observed.downstreamAbortHandled = true;
  } finally {
    res.off('close', disconnect);
  }
}
