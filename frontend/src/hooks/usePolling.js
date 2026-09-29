import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Custom polling hook for asynchronous jobs.
 *
 * @param {Function} fetchFn Async function that returns data
 * @param {Object} options Configuration options
 * @param {number} options.interval Polling interval in ms (default: 3000)
 * @param {number} options.timeout Max polling duration in ms (default: 180000 = 3 min)
 * @param {Function} options.shouldStop Predicate returning true to stop polling
 * @param {boolean} options.enabled Whether polling is enabled (default: true)
 * @param {Function} options.onComplete Callback when terminal state is reached
 * @param {Function} options.onError Callback on fetch error
 */
export function usePolling(fetchFn, options = {}) {
  const {
    interval = 3000,
    timeout = 180000,
    shouldStop = (data) => ["READY", "FAILED", "TERMINATED"].includes(data?.status),
    enabled = true,
    onComplete,
    onError,
  } = options;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPolling, setIsPolling] = useState(enabled);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Keep references to options and callbacks to avoid effect dependency churn
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const shouldStopRef = useRef(shouldStop);
  shouldStopRef.current = shouldStop;

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const stopRef = useRef(false);
  const hasNotifiedTerminalRef = useRef(false);

  const executeFetch = useCallback(async () => {
    try {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
      }
      const result = await fetchFnRef.current();
      setData(result);
      setError(null);
      setLastUpdated(new Date());

      const elapsed = Date.now() - startTimeRef.current;
      setElapsedMs(elapsed);

      // Check terminal condition
      if (shouldStopRef.current(result)) {
        stopRef.current = true;
        setIsPolling(false);
        if (!hasNotifiedTerminalRef.current) {
          hasNotifiedTerminalRef.current = true;
          if (onCompleteRef.current) {
            onCompleteRef.current(result);
          }
        }
        return;
      }

      // Check timeout
      if (elapsed >= timeout) {
        stopRef.current = true;
        setIsPolling(false);
        const timeoutErr = new Error("Polling timed out. Check AWS Step Functions execution console.");
        setError(timeoutErr);
        if (onErrorRef.current) {
          onErrorRef.current(timeoutErr);
        }
        return;
      }
    } catch (err) {
      setError(err);
      if (onErrorRef.current) {
        onErrorRef.current(err);
      }
    } finally {
      setIsLoading(false);
    }
  }, [timeout]);

  const stop = useCallback(() => {
    stopRef.current = true;
    setIsPolling(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
  }, []);

  const refresh = useCallback(() => {
    setIsLoading(true);
    stopRef.current = false;
    hasNotifiedTerminalRef.current = false;
    startTimeRef.current = Date.now();
    setIsPolling(true);
    return executeFetch();
  }, [executeFetch]);

  useEffect(() => {
    if (!enabled) {
      setIsPolling(false);
      return;
    }

    stopRef.current = false;
    hasNotifiedTerminalRef.current = false;
    setIsPolling(true);
    startTimeRef.current = Date.now();

    // Initial fetch
    executeFetch();

    // Polling loop
    const scheduleNext = () => {
      if (stopRef.current) return;
      timerRef.current = setTimeout(async () => {
        if (stopRef.current) return;
        await executeFetch();
        if (!stopRef.current) {
          scheduleNext();
        }
      }, interval);
    };

    scheduleNext();

    return () => {
      stopRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [enabled, interval, executeFetch]);

  return {
    data,
    error,
    isLoading,
    isPolling,
    lastUpdated,
    elapsedMs,
    refresh,
    stop,
  };
}
