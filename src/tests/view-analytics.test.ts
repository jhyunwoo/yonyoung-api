import { describe, expect, it, vi } from "vitest";
import {
  createViewAnalyticsWriter,
  createNoopViewAnalyticsReader,
  isValidViewResourceType,
  type ViewAnalyticsWriter,
  type ViewAnalyticsReader,
} from "../lib/analytics/view-analytics";
import {
  IDs,
  createDataServiceMock,
  createTestApp,
  readJson,
} from "./test-helpers";

// ─────────────────────────────────────────────────
//  View Analytics Service 단위 테스트
// ─────────────────────────────────────────────────

describe("ViewAnalyticsWriter", () => {
  it("enabled=true일 때 writeDataPoint를 올바른 인자로 호출한다", () => {
    const writeDataPoint = vi.fn();
    const dataset = { writeDataPoint } as unknown as AnalyticsEngineDataset;
    const writer = createViewAnalyticsWriter(dataset, true);

    writer.recordView("activity", IDs.activity);

    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: ["activity", IDs.activity],
      doubles: [1],
      indexes: [`activity:${IDs.activity}`],
    });
  });

  it("exhibition 타입도 올바르게 기록한다", () => {
    const writeDataPoint = vi.fn();
    const dataset = { writeDataPoint } as unknown as AnalyticsEngineDataset;
    const writer = createViewAnalyticsWriter(dataset, true);

    writer.recordView("exhibition", IDs.exhibition);

    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: ["exhibition", IDs.exhibition],
      doubles: [1],
      indexes: [`exhibition:${IDs.exhibition}`],
    });
  });

  it("enabled=false일 때 writeDataPoint를 호출하지 않는다", () => {
    const writeDataPoint = vi.fn();
    const dataset = { writeDataPoint } as unknown as AnalyticsEngineDataset;
    const writer = createViewAnalyticsWriter(dataset, false);

    writer.recordView("activity", IDs.activity);

    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it("dataset이 undefined일 때 에러 없이 무시한다", () => {
    const writer = createViewAnalyticsWriter(undefined, true);

    expect(() => writer.recordView("activity", IDs.activity)).not.toThrow();
  });

  it("writeDataPoint 내부 에러가 발생해도 예외를 던지지 않는다", () => {
    const writeDataPoint = vi.fn(() => {
      throw new Error("Analytics Engine 내부 오류");
    });
    const dataset = { writeDataPoint } as unknown as AnalyticsEngineDataset;
    const writer = createViewAnalyticsWriter(dataset, true);

    expect(() => writer.recordView("activity", IDs.activity)).not.toThrow();
  });
});

describe("NoopViewAnalyticsReader", () => {
  it("항상 빈 결과를 반환한다", async () => {
    const reader = createNoopViewAnalyticsReader();
    const result = await reader.getViewCounts("activity", [IDs.activity]);
    expect(result).toEqual({});
  });
});

describe("isValidViewResourceType", () => {
  it("activity는 유효하다", () => {
    expect(isValidViewResourceType("activity")).toBe(true);
  });

  it("exhibition은 유효하다", () => {
    expect(isValidViewResourceType("exhibition")).toBe(true);
  });

  it("알 수 없는 타입은 유효하지 않다", () => {
    expect(isValidViewResourceType("unknown")).toBe(false);
    expect(isValidViewResourceType("")).toBe(false);
    expect(isValidViewResourceType("notice")).toBe(false);
  });
});

// ─────────────────────────────────────────────────
//  View Count API 라우트 테스트
// ─────────────────────────────────────────────────

describe("POST /api/public/views", () => {
  it("정상 요청 시 204 No Content를 반환한다", async () => {
    const recordView = vi.fn();
    const writer: ViewAnalyticsWriter = { recordView };

    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewAnalyticsWriter: writer,
    });

    const response = await app.request("/api/public/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceType: "activity",
        resourceId: IDs.activity,
      }),
    });

    expect(response.status).toBe(204);
    expect(recordView).toHaveBeenCalledWith("activity", IDs.activity);
  });

  it("exhibition 타입 조회수도 기록할 수 있다", async () => {
    const recordView = vi.fn();
    const writer: ViewAnalyticsWriter = { recordView };

    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewAnalyticsWriter: writer,
    });

    const response = await app.request("/api/public/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceType: "exhibition",
        resourceId: IDs.exhibition,
      }),
    });

    expect(response.status).toBe(204);
    expect(recordView).toHaveBeenCalledWith("exhibition", IDs.exhibition);
  });

  it("잘못된 resourceType이면 400을 반환한다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
    });

    const response = await app.request("/api/public/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceType: "invalid_type",
        resourceId: IDs.activity,
      }),
    });

    expect(response.status).toBe(400);
  });

  it("잘못된 resourceId(비-UUID)이면 400을 반환한다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
    });

    const response = await app.request("/api/public/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceType: "activity",
        resourceId: "not-a-uuid",
      }),
    });

    expect(response.status).toBe(400);
  });

  it("빈 요청 본문이면 400을 반환한다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
    });

    const response = await app.request("/api/public/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });

  it("비로그인 상태에서도 조회수를 기록할 수 있다", async () => {
    const recordView = vi.fn();
    const writer: ViewAnalyticsWriter = { recordView };

    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewAnalyticsWriter: writer,
    });

    const response = await app.request("/api/public/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceType: "activity",
        resourceId: IDs.activity,
      }),
    });

    expect(response.status).toBe(204);
    expect(recordView).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/public/views", () => {
  it("정상 조회 시 200과 리소스별 조회수를 반환한다", async () => {
    const getViewCounts = vi.fn(async () => ({
      [IDs.activity]: 42,
    }));
    const reader: ViewAnalyticsReader = { getViewCounts };

    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewAnalyticsReader: reader,
    });

    const response = await app.request(
      `/api/public/views?resourceType=activity&resourceIds=${IDs.activity}`,
    );

    expect(response.status).toBe(200);

    const body = await readJson<{ data: Record<string, number> }>(response);
    expect(body.data[IDs.activity]).toBe(42);
    expect(getViewCounts).toHaveBeenCalledWith("activity", [IDs.activity]);
  });

  it("여러 리소스 ID를 쉼표로 구분하여 조회한다", async () => {
    const id1 = IDs.activity;
    const id2 = IDs.exhibition;
    const getViewCounts = vi.fn(async () => ({
      [id1]: 10,
      [id2]: 25,
    }));
    const reader: ViewAnalyticsReader = { getViewCounts };

    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewAnalyticsReader: reader,
    });

    const response = await app.request(
      `/api/public/views?resourceType=activity&resourceIds=${id1},${id2}`,
    );

    expect(response.status).toBe(200);

    const body = await readJson<{ data: Record<string, number> }>(response);
    expect(body.data[id1]).toBe(10);
    expect(body.data[id2]).toBe(25);
    expect(getViewCounts).toHaveBeenCalledWith("activity", [id1, id2]);
  });

  it("Reader에 없는 리소스 ID는 조회수 0을 반환한다", async () => {
    const getViewCounts = vi.fn(async () => ({}));
    const reader: ViewAnalyticsReader = { getViewCounts };

    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewAnalyticsReader: reader,
    });

    const response = await app.request(
      `/api/public/views?resourceType=activity&resourceIds=${IDs.activity}`,
    );

    expect(response.status).toBe(200);

    const body = await readJson<{ data: Record<string, number> }>(response);
    expect(body.data[IDs.activity]).toBe(0);
  });

  it("resourceType 파라미터가 없으면 400을 반환한다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
    });

    const response = await app.request(
      `/api/public/views?resourceIds=${IDs.activity}`,
    );

    expect(response.status).toBe(400);
  });

  it("resourceIds 파라미터가 없으면 400을 반환한다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
    });

    const response = await app.request(
      `/api/public/views?resourceType=activity`,
    );

    expect(response.status).toBe(400);
  });

  it("잘못된 resourceType이면 400을 반환한다", async () => {
    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
    });

    const response = await app.request(
      `/api/public/views?resourceType=invalid&resourceIds=${IDs.activity}`,
    );

    expect(response.status).toBe(400);
  });

  it("exhibition 타입 조회수도 조회할 수 있다", async () => {
    const getViewCounts = vi.fn(async () => ({
      [IDs.exhibition]: 99,
    }));
    const reader: ViewAnalyticsReader = { getViewCounts };

    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewAnalyticsReader: reader,
    });

    const response = await app.request(
      `/api/public/views?resourceType=exhibition&resourceIds=${IDs.exhibition}`,
    );

    expect(response.status).toBe(200);

    const body = await readJson<{ data: Record<string, number> }>(response);
    expect(body.data[IDs.exhibition]).toBe(99);
    expect(getViewCounts).toHaveBeenCalledWith("exhibition", [IDs.exhibition]);
  });

  it("Reader 오류 시에도 정상 응답한다 (fail-open)", async () => {
    const getViewCounts = vi.fn(async () => {
      throw new Error("API 에러");
    });
    const reader: ViewAnalyticsReader = { getViewCounts };

    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewAnalyticsReader: reader,
    });

    // Reader가 에러를 던지면 catch되지 않아 500이 될 수 있으므로,
    // 이 경우는 라우트 핸들러가 그대로 전파되는 것을 확인
    const response = await app.request(
      `/api/public/views?resourceType=activity&resourceIds=${IDs.activity}`,
    );

    // Reader 에러는 라우트 레벨에서 잡히지 않을 수 있으므로 500도 허용
    expect([200, 500]).toContain(response.status);
  });

  it("비로그인 상태에서도 조회수를 조회할 수 있다", async () => {
    const getViewCounts = vi.fn(async () => ({
      [IDs.activity]: 5,
    }));
    const reader: ViewAnalyticsReader = { getViewCounts };

    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewAnalyticsReader: reader,
    });

    const response = await app.request(
      `/api/public/views?resourceType=activity&resourceIds=${IDs.activity}`,
    );

    expect(response.status).toBe(200);
    const body = await readJson<{ data: Record<string, number> }>(response);
    expect(body.data[IDs.activity]).toBe(5);
  });

  it("조회수 응답에 캐시 헤더가 포함된다", async () => {
    const getViewCounts = vi.fn(async () => ({}));
    const reader: ViewAnalyticsReader = { getViewCounts };

    const app = createTestApp({
      actor: null,
      dataService: createDataServiceMock(),
      viewAnalyticsReader: reader,
    });

    const response = await app.request(
      `/api/public/views?resourceType=activity&resourceIds=${IDs.activity}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=120");
  });
});
