export const VISION_LIMITS = Object.freeze({ documents: 2, pagesPerDocument: 2, totalPages: 4 })
// Two document workers × two page workers bound outbound model calls to four.
// Wait for all in-flight pages on failure so durable results never arrive after a failed terminal state.
export async function processPagePool(pages, processPage, concurrency = 2) {
  let cursor = 0, failure
  const work = async () => {
    while (!failure && cursor < pages.length) {
      const page = pages[cursor++]
      try { await processPage(page) } catch (error) { failure ||= error }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, work))
  if (failure) throw failure
}
