/**
 * Maps items with an async function, running at most `concurrency` calls at a time. Results keep the
 * order of the items. The first rejection rejects the whole map and no further calls are started.
 */
const mapLimit = async (items, fn, concurrency = Infinity) => {
  const list = Array.from(items);
  const limit = Math.max(1, Math.min(concurrency, list.length));
  const results = new Array(list.length);
  let next = 0;
  let failed = false;

  const worker = async () => {
    while (!failed && next < list.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await fn(list[index], index);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
};

module.exports = { mapLimit };
