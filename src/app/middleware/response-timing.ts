import type { MiddlewareHandler } from "hono";
import type HonoAppType from "../../types/honoAppType";

// 프록시/브라우저에서 엣지 지연을 구분할 수 있도록 총 처리 시간을 응답 헤더로 노출한다.
export const responseTimingMiddleware: MiddlewareHandler<HonoAppType> = async (
  c,
  next,
) => {
  const startedAt = c.get("startedAt") ?? performance.now();

  await next();

  const durationMs = performance.now() - startedAt;
  const timingMetric = `total;dur=${durationMs.toFixed(2)}`;
  const existing = c.res.headers.get("Server-Timing");
  c.res.headers.set(
    "Server-Timing",
    existing ? `${existing}, ${timingMetric}` : timingMetric,
  );
  c.res.headers.set("X-Response-Time", `${durationMs.toFixed(2)}ms`);
};
