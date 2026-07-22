export type PageViewType = "home" | "activity" | "exhibition" | "notice";

export const isEntityPageViewType = (
  pageType: PageViewType,
): pageType is "activity" | "exhibition" =>
  pageType === "activity" || pageType === "exhibition";

/**
 * Home and notice are singleton pages. Canonical IDs keep both counters
 * bounded even when older clients send an arbitrary resourceId.
 */
export const normalizePageViewResourceId = (
  pageType: PageViewType,
  resourceId: string | undefined,
): string => {
  if (pageType === "home" || pageType === "notice") {
    return pageType;
  }

  return resourceId ?? "";
};
