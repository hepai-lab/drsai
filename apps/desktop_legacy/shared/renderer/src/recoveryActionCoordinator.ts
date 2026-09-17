export async function executeRecoveryActionOnce(
  inFlight: Set<string>,
  key: string,
  operation: () => void | Promise<void>,
): Promise<boolean> {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  try {
    await operation();
    return true;
  } finally {
    inFlight.delete(key);
  }
}
