export interface Hashable {
  hash(): string;
}

type ResolvedResult<T> = {
  id: number; value: T;
};

type RejectedResult = {
  id: number; error: unknown;
};

async function wrap<T>(id: number, p: Promise<T>): Promise<ResolvedResult<T>|RejectedResult> {
  try {
    return {id, value: await p};
  } catch (error) {
    return {id, error};
  }
}

// majorityResult will resolve as soon as a majority of the provided Promises agree on a result. It
// will reject if a majority fail or if no majority can be reached.
export async function majorityResult<T extends string|Hashable>(promises: Promise<T>[]):
    Promise<T> {
  // Determine what constitutes a majority.
  const majority = Math.floor(promises.length / 2) + 1;

  // Wrap each input in a new Promise that has an "id" associated with it and that will always
  // resolve. We do this so that we can track which Promises have settled and which haven't.
  const unsettledById = new Map(promises.map((p, i) => [i, wrap(i, p)]));

  // We'll keep track of the total failure count (rejected promises) and a count for each unique
  // result that we see. We're done once any of these counts reaches a majority.
  let errCount = 0;
  const resultCounts = new Map<string, number>();

  while (unsettledById.size) {
    // Determine whether it's still possible for any seen result to become a majority.
    // If not, we can stop.
    if (resultCounts.size) {
      const candidateExists =
          [...resultCounts.values()].some(count => count + unsettledById.size >= majority);
      if (!candidateExists) {
        break;
      }
    }

    // Wait for the fastest currently-unsettled Promise to finish.
    const settled = await Promise.race(unsettledById.values());
    unsettledById.delete(settled.id);

    // If the input Promise rejected, we'll get our RejectedResult wrapper back.
    if ('error' in settled) {
      errCount++;
      if (errCount >= majority) {
        break;
      }
      continue;
    }

    // The input Promise succeeded, increment the counter for its response value.
    const hash = (typeof settled.value === 'string') ? settled.value : settled.value.hash();
    const seenCount = (resultCounts.get(hash) || 0) + 1;
    resultCounts.set(hash, seenCount);

    // If we've reached a majority for this response value, we're done.
    if (seenCount >= majority) {
      return settled.value;
    }
  }

  const stats = `total=${promises.length} errorCount=${errCount} uniqueValues=${resultCounts.size}`;
  throw new Error(`No majority: ${stats}`);
}