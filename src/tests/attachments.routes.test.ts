import { describe, expect, it } from "vitest";
import type { AttachmentEntity } from "../lib/services/types";
import {
  IDs,
  MANAGED_FILE_TEST_ENV,
  buildManagedFileUrl,
  createActor,
  createAttachment,
  createDataServiceMock,
  createTestApp,
  expectErrorCode,
  fn,
  readJson,
} from "./test-helpers";

const jsonHeaders = { "content-type": "application/json" };

describe("attachments routes", () => {
  describe("GET /api/attachments", () => {
    it("미로그인 사용자는 401을 반환한다", async () => {
      const listAttachments = fn(async () => [createAttachment()]);
      const app = createTestApp({
        actor: null,
        dataService: createDataServiceMock({ listAttachments }),
      });

      const response = await app.request("/api/attachments?scope=site_donate");

      expect(response.status).toBe(401);
      await expectErrorCode(response, "UNAUTHORIZED");
      expect(listAttachments).not.toHaveBeenCalled();
    });

    it("미인증(unverified) 역할은 403을 반환한다", async () => {
      const listAttachments = fn(async () => [createAttachment()]);
      const app = createTestApp({
        actor: createActor("unverified"),
        dataService: createDataServiceMock({ listAttachments }),
      });

      const response = await app.request("/api/attachments?scope=site_donate");

      expect(response.status).toBe(403);
      await expectErrorCode(response, "FORBIDDEN");
      expect(listAttachments).not.toHaveBeenCalled();
    });

    it("일반 멤버는 site_donate 첨부 목록을 조회할 수 있다", async () => {
      const listAttachments = fn(async () => [createAttachment()]);
      const app = createTestApp({
        actor: createActor("regular_member"),
        dataService: createDataServiceMock({ listAttachments }),
      });

      const response = await app.request("/api/attachments?scope=site_donate");

      expect(response.status).toBe(200);
      const body = await readJson<{ data: Array<{ id: string; title: string }> }>(
        response,
      );
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(IDs.attachment);
      expect(listAttachments).toHaveBeenCalledWith("site_donate", null);
    });

    it("scope=activity는 resourceId 필터를 전달한다", async () => {
      const listAttachments = fn(async () => [] as AttachmentEntity[]);
      const app = createTestApp({
        actor: createActor("manager", IDs.manager),
        dataService: createDataServiceMock({ listAttachments }),
      });

      const response = await app.request(
        `/api/attachments?scope=activity&resourceId=${IDs.activity}`,
      );

      expect(response.status).toBe(200);
      expect(listAttachments).toHaveBeenCalledWith("activity", IDs.activity);
    });

    it("잘못된 scope는 400을 반환한다", async () => {
      const app = createTestApp({
        actor: createActor("manager", IDs.manager),
        dataService: createDataServiceMock(),
      });

      const response = await app.request("/api/attachments?scope=unknown");

      expect(response.status).toBe(400);
      await expectErrorCode(response, "BAD_REQUEST");
    });
  });

  describe("POST /api/attachments", () => {
    const validFilePayload = {
      scope: "site_donate",
      title: "2026년 6월 회계 내역",
      fileUrl: buildManagedFileUrl("site", IDs.vicePresident),
      fileName: "2026-06-회계내역.pdf",
      fileSize: 1048576,
      mimeType: "application/pdf",
    };

    it("운영진(manager)은 site_donate 첨부를 등록할 수 없다", async () => {
      const addAttachment = fn(async () => createAttachment());
      const app = createTestApp({
        actor: createActor("manager", IDs.manager),
        dataService: createDataServiceMock({ addAttachment }),
      });

      const response = await app.request(
        "/api/attachments",
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify(validFilePayload),
        },
        MANAGED_FILE_TEST_ENV,
      );

      expect(response.status).toBe(403);
      await expectErrorCode(response, "FORBIDDEN");
      expect(addAttachment).not.toHaveBeenCalled();
    });

    it("부회장은 site_donate 파일 첨부를 등록할 수 있다", async () => {
      const addAttachment = fn(async () => createAttachment());
      const createAuditLog = fn(async () => undefined);
      const app = createTestApp({
        actor: createActor("vice_president", IDs.vicePresident),
        dataService: createDataServiceMock({ addAttachment, createAuditLog }),
      });

      const response = await app.request(
        "/api/attachments",
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify(validFilePayload),
        },
        MANAGED_FILE_TEST_ENV,
      );

      expect(response.status).toBe(201);
      const body = await readJson<{ data: { id: string; linkUrl: string | null } }>(
        response,
      );
      expect(body.data.id).toBe(IDs.attachment);
      expect(addAttachment).toHaveBeenCalledWith({
        scope: "site_donate",
        resourceId: null,
        title: "2026년 6월 회계 내역",
        fileUrl: validFilePayload.fileUrl,
        fileName: "2026-06-회계내역.pdf",
        fileSize: 1048576,
        mimeType: "application/pdf",
        linkUrl: null,
        sortOrder: 0,
      });
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: "attachment",
          action: "create",
        }),
      );
    });

    it("부회장은 site_donate 링크 첨부(구글 독스 등)를 등록할 수 있다", async () => {
      const linkAttachment = createAttachment({
        fileUrl: null,
        fileName: null,
        fileSize: null,
        mimeType: null,
        linkUrl: "https://docs.google.com/spreadsheets/d/abc",
      });
      const addAttachment = fn(async () => linkAttachment);
      const createAuditLog = fn(async () => undefined);
      const app = createTestApp({
        actor: createActor("vice_president", IDs.vicePresident),
        dataService: createDataServiceMock({ addAttachment, createAuditLog }),
      });

      const response = await app.request("/api/attachments", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          scope: "site_donate",
          title: "2026년 회계 시트",
          linkUrl: "https://docs.google.com/spreadsheets/d/abc",
        }),
      });

      expect(response.status).toBe(201);
      const body = await readJson<{ data: { linkUrl: string | null; fileUrl: string | null } }>(
        response,
      );
      expect(body.data.linkUrl).toBe("https://docs.google.com/spreadsheets/d/abc");
      expect(body.data.fileUrl).toBeNull();
      expect(addAttachment).toHaveBeenCalledWith({
        scope: "site_donate",
        resourceId: null,
        title: "2026년 회계 시트",
        fileUrl: null,
        fileName: null,
        fileSize: null,
        mimeType: null,
        linkUrl: "https://docs.google.com/spreadsheets/d/abc",
        sortOrder: 0,
      });
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: "attachment",
          action: "create",
          changedFields: ["title", "linkUrl"],
        }),
      );
    });

    it("파일 필드 세트와 linkUrl을 동시에 전달하면 400을 반환한다", async () => {
      const addAttachment = fn(async () => createAttachment());
      const app = createTestApp({
        actor: createActor("vice_president", IDs.vicePresident),
        dataService: createDataServiceMock({ addAttachment }),
      });

      const response = await app.request("/api/attachments", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          ...validFilePayload,
          linkUrl: "https://docs.google.com/spreadsheets/d/abc",
        }),
      });

      expect(response.status).toBe(400);
      await expectErrorCode(response, "BAD_REQUEST");
      expect(addAttachment).not.toHaveBeenCalled();
    });

    it("파일 필드 세트가 불완전하면 400을 반환한다", async () => {
      const addAttachment = fn(async () => createAttachment());
      const app = createTestApp({
        actor: createActor("vice_president", IDs.vicePresident),
        dataService: createDataServiceMock({ addAttachment }),
      });

      const response = await app.request("/api/attachments", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          scope: "site_donate",
          title: "회계 내역",
          fileUrl: buildManagedFileUrl("site"),
          fileName: "회계.pdf",
        }),
      });

      expect(response.status).toBe(400);
      await expectErrorCode(response, "BAD_REQUEST");
      expect(addAttachment).not.toHaveBeenCalled();
    });

    it("http(s)가 아닌 linkUrl은 400을 반환한다", async () => {
      const addAttachment = fn(async () => createAttachment());
      const app = createTestApp({
        actor: createActor("vice_president", IDs.vicePresident),
        dataService: createDataServiceMock({ addAttachment }),
      });

      const response = await app.request("/api/attachments", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          scope: "site_donate",
          title: "회계 시트",
          linkUrl: "ftp://example.com/report.pdf",
        }),
      });

      expect(response.status).toBe(400);
      await expectErrorCode(response, "BAD_REQUEST");
      expect(addAttachment).not.toHaveBeenCalled();
    });

    it("설정된 BETTER_AUTH_URL과 origin이 다른 fileUrl은 400을 반환한다", async () => {
      const addAttachment = fn(async () => createAttachment());
      const app = createTestApp({
        actor: createActor("vice_president", IDs.vicePresident),
        dataService: createDataServiceMock({ addAttachment }),
      });

      const foreignOriginUrl = new URL(validFilePayload.fileUrl);
      foreignOriginUrl.host = "evil.example.com";

      const response = await app.request(
        "/api/attachments",
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            ...validFilePayload,
            fileUrl: foreignOriginUrl.toString(),
          }),
        },
        MANAGED_FILE_TEST_ENV,
      );

      expect(response.status).toBe(400);
      await expectErrorCode(response, "BAD_REQUEST");
      expect(addAttachment).not.toHaveBeenCalled();
    });

    it("서명이 변조된 fileUrl은 400을 반환한다", async () => {
      const addAttachment = fn(async () => createAttachment());
      const app = createTestApp({
        actor: createActor("vice_president", IDs.vicePresident),
        dataService: createDataServiceMock({ addAttachment }),
      });
      const tamperedUrl = new URL(validFilePayload.fileUrl);
      tamperedUrl.searchParams.set("sig", "tampered-signature");

      const response = await app.request(
        "/api/attachments",
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            ...validFilePayload,
            fileUrl: tamperedUrl.toString(),
          }),
        },
        MANAGED_FILE_TEST_ENV,
      );

      expect(response.status).toBe(400);
      await expectErrorCode(response, "BAD_REQUEST");
      expect(addAttachment).not.toHaveBeenCalled();
    });

    it("다른 사용자가 발급받은 fileUrl은 400을 반환한다", async () => {
      const addAttachment = fn(async () => createAttachment());
      const app = createTestApp({
        actor: createActor("vice_president", IDs.vicePresident),
        dataService: createDataServiceMock({ addAttachment }),
      });

      const response = await app.request(
        "/api/attachments",
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            ...validFilePayload,
            fileUrl: buildManagedFileUrl("site", IDs.president),
          }),
        },
        MANAGED_FILE_TEST_ENV,
      );

      expect(response.status).toBe(400);
      await expectErrorCode(response, "BAD_REQUEST");
      expect(addAttachment).not.toHaveBeenCalled();
    });

    it("scope와 objectKey 경로가 어긋난 fileUrl은 400을 반환한다", async () => {
      const addAttachment = fn(async () => createAttachment());
      const app = createTestApp({
        actor: createActor("vice_president", IDs.vicePresident),
        dataService: createDataServiceMock({ addAttachment }),
      });

      const response = await app.request(
        "/api/attachments",
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            ...validFilePayload,
            // site_donate scope인데 activities 경로의 파일을 첨부하려는 경우
            fileUrl: buildManagedFileUrl("activities", IDs.vicePresident),
          }),
        },
        MANAGED_FILE_TEST_ENV,
      );

      expect(response.status).toBe(400);
      await expectErrorCode(response, "BAD_REQUEST");
      expect(addAttachment).not.toHaveBeenCalled();
    });

    it("운영진은 활동(scope=activity) 첨부를 등록할 수 있다", async () => {
      const activityAttachment = createAttachment({
        scope: "activity",
        resourceId: IDs.activity,
        fileUrl: buildManagedFileUrl("activities", IDs.manager),
      });
      const addAttachment = fn(async () => activityAttachment);
      const createAuditLog = fn(async () => undefined);
      const app = createTestApp({
        actor: createActor("manager", IDs.manager),
        dataService: createDataServiceMock({ addAttachment, createAuditLog }),
      });

      const response = await app.request(
        "/api/attachments",
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            scope: "activity",
            resourceId: IDs.activity,
            title: "월간연영회 5월호",
            fileUrl: buildManagedFileUrl("activities", IDs.manager),
            fileName: "월간연영회 5월호.pdf",
            fileSize: 27626263,
            mimeType: "application/pdf",
          }),
        },
        MANAGED_FILE_TEST_ENV,
      );

      expect(response.status).toBe(201);
      expect(addAttachment).toHaveBeenCalledWith(
        expect.objectContaining({ scope: "activity", resourceId: IDs.activity }),
      );
    });

    it("scope=activity인데 resourceId가 없으면 400을 반환한다", async () => {
      const addAttachment = fn(async () => createAttachment());
      const app = createTestApp({
        actor: createActor("manager", IDs.manager),
        dataService: createDataServiceMock({ addAttachment }),
      });

      const response = await app.request("/api/attachments", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          scope: "activity",
          title: "월간연영회 5월호",
          fileUrl: buildManagedFileUrl("activities", IDs.manager),
          fileName: "월간연영회 5월호.pdf",
          fileSize: 27626263,
          mimeType: "application/pdf",
        }),
      });

      expect(response.status).toBe(400);
      await expectErrorCode(response, "BAD_REQUEST");
      expect(addAttachment).not.toHaveBeenCalled();
    });

    it("첨부 대상 활동이 없으면 404를 반환한다", async () => {
      const addAttachment = fn(async () => null);
      const app = createTestApp({
        actor: createActor("manager", IDs.manager),
        dataService: createDataServiceMock({ addAttachment }),
      });

      const response = await app.request(
        "/api/attachments",
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            scope: "activity",
            resourceId: IDs.otherUuid,
            title: "월간연영회 5월호",
            fileUrl: buildManagedFileUrl("activities", IDs.manager),
            fileName: "월간연영회 5월호.pdf",
            fileSize: 27626263,
            mimeType: "application/pdf",
          }),
        },
        MANAGED_FILE_TEST_ENV,
      );

      expect(response.status).toBe(404);
      await expectErrorCode(response, "NOT_FOUND");
    });
  });

  describe("PATCH /api/attachments/{id}", () => {
    it("운영진은 site_donate 첨부를 수정할 수 없다", async () => {
      const getAttachmentById = fn(async () => createAttachment());
      const updateAttachment = fn(async () => createAttachment());
      const app = createTestApp({
        actor: createActor("manager", IDs.manager),
        dataService: createDataServiceMock({ getAttachmentById, updateAttachment }),
      });

      const response = await app.request(`/api/attachments/${IDs.attachment}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ title: "수정된 제목" }),
      });

      expect(response.status).toBe(403);
      await expectErrorCode(response, "FORBIDDEN");
      expect(updateAttachment).not.toHaveBeenCalled();
    });

    it("부회장은 제목/노출 순서를 수정할 수 있다", async () => {
      const getAttachmentById = fn(async () => createAttachment());
      const updateAttachment = fn(async () =>
        createAttachment({ title: "수정된 제목", sortOrder: 3 }),
      );
      const createAuditLog = fn(async () => undefined);
      const app = createTestApp({
        actor: createActor("vice_president", IDs.vicePresident),
        dataService: createDataServiceMock({
          getAttachmentById,
          updateAttachment,
          createAuditLog,
        }),
      });

      const response = await app.request(`/api/attachments/${IDs.attachment}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ title: "수정된 제목", sortOrder: 3 }),
      });

      expect(response.status).toBe(200);
      const body = await readJson<{ data: { title: string; sortOrder: number } }>(
        response,
      );
      expect(body.data.title).toBe("수정된 제목");
      expect(body.data.sortOrder).toBe(3);
      expect(updateAttachment).toHaveBeenCalledWith(IDs.attachment, {
        title: "수정된 제목",
        sortOrder: 3,
      });
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: "attachment",
          action: "update",
          changedFields: ["sortOrder", "title"],
        }),
      );
    });

    it("수정할 필드가 없으면 400을 반환한다", async () => {
      const app = createTestApp({
        actor: createActor("vice_president", IDs.vicePresident),
        dataService: createDataServiceMock(),
      });

      const response = await app.request(`/api/attachments/${IDs.attachment}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      await expectErrorCode(response, "BAD_REQUEST");
    });

    it("허용되지 않은 필드(fileUrl 등)를 수정하려 하면 400을 반환한다", async () => {
      const app = createTestApp({
        actor: createActor("vice_president", IDs.vicePresident),
        dataService: createDataServiceMock(),
      });

      const response = await app.request(`/api/attachments/${IDs.attachment}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ fileUrl: "https://example.com/x.pdf" }),
      });

      expect(response.status).toBe(400);
      await expectErrorCode(response, "BAD_REQUEST");
    });

    it("존재하지 않는 첨부는 404를 반환한다", async () => {
      const getAttachmentById = fn(async () => null);
      const app = createTestApp({
        actor: createActor("vice_president", IDs.vicePresident),
        dataService: createDataServiceMock({ getAttachmentById }),
      });

      const response = await app.request(`/api/attachments/${IDs.otherUuid}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ title: "수정된 제목" }),
      });

      expect(response.status).toBe(404);
      await expectErrorCode(response, "NOT_FOUND");
    });
  });

  describe("DELETE /api/attachments/{id}", () => {
    it("운영진은 site_donate 첨부를 삭제할 수 없다", async () => {
      const getAttachmentById = fn(async () => createAttachment());
      const deleteAttachment = fn(async () => true);
      const app = createTestApp({
        actor: createActor("manager", IDs.manager),
        dataService: createDataServiceMock({ getAttachmentById, deleteAttachment }),
      });

      const response = await app.request(`/api/attachments/${IDs.attachment}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(403);
      await expectErrorCode(response, "FORBIDDEN");
      expect(deleteAttachment).not.toHaveBeenCalled();
    });

    it("운영진은 활동 첨부를 삭제할 수 있다", async () => {
      const getAttachmentById = fn(async () =>
        createAttachment({ scope: "activity", resourceId: IDs.activity }),
      );
      const deleteAttachment = fn(async () => true);
      const createAuditLog = fn(async () => undefined);
      const app = createTestApp({
        actor: createActor("manager", IDs.manager),
        dataService: createDataServiceMock({
          getAttachmentById,
          deleteAttachment,
          createAuditLog,
        }),
      });

      const response = await app.request(`/api/attachments/${IDs.attachment}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(204);
      expect(deleteAttachment).toHaveBeenCalledWith(IDs.attachment);
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: "attachment",
          action: "delete",
          changedFields: ["deleted"],
        }),
      );
    });

    it("존재하지 않는 첨부는 404를 반환한다", async () => {
      const getAttachmentById = fn(async () => null);
      const app = createTestApp({
        actor: createActor("president", IDs.president),
        dataService: createDataServiceMock({ getAttachmentById }),
      });

      const response = await app.request(`/api/attachments/${IDs.otherUuid}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(404);
      await expectErrorCode(response, "NOT_FOUND");
    });
  });

  describe("GET /api/public/attachments", () => {
    it("비로그인 사용자도 공개 첨부 목록을 조회할 수 있다", async () => {
      const listAttachments = fn(async () => [createAttachment()]);
      const app = createTestApp({
        actor: null,
        dataService: createDataServiceMock({ listAttachments }),
      });

      const response = await app.request(
        "/api/public/attachments?scope=site_donate",
        undefined,
        MANAGED_FILE_TEST_ENV,
      );

      expect(response.status).toBe(200);
      const body = await readJson<{ data: Array<{ id: string }> }>(response);
      expect(body.data).toHaveLength(1);
      expect(listAttachments).toHaveBeenCalledWith("site_donate", null);
    });

    it("레거시 공개 첨부 중 안전한 외부 링크와 검증된 관리 파일만 반환한다", async () => {
      const foreignFileUrl = new URL(buildManagedFileUrl("site"));
      foreignFileUrl.host = "evil.example.com";
      const listAttachments = fn(async () => [
        createAttachment({ title: "검증된 관리 파일" }),
        createAttachment({
          title: "안전한 외부 링크",
          fileUrl: null,
          fileName: null,
          fileSize: null,
          mimeType: null,
          linkUrl: "https://docs.example.com/report",
        }),
        createAttachment({
          title: "실행 가능 링크",
          fileUrl: null,
          fileName: null,
          fileSize: null,
          mimeType: null,
          linkUrl: "javascript:alert(1)",
        }),
        createAttachment({
          title: "외부 origin 파일",
          fileUrl: foreignFileUrl.toString(),
        }),
      ]);
      const app = createTestApp({
        actor: null,
        dataService: createDataServiceMock({ listAttachments }),
      });

      const response = await app.request(
        "/api/public/attachments?scope=site_donate",
        undefined,
        MANAGED_FILE_TEST_ENV,
      );

      expect(response.status).toBe(200);
      const body = await readJson<{ data: Array<{ title: string }> }>(response);
      expect(body.data.map((attachment) => attachment.title)).toEqual([
        "검증된 관리 파일",
        "안전한 외부 링크",
      ]);
    });

    it("상위 활동이 없거나 삭제된 경우 공개 첨부 목록을 비워 반환한다", async () => {
      const getActivityById = fn(async () => null);
      const listAttachments = fn(async () => [
        createAttachment({ scope: "activity", resourceId: IDs.activity }),
      ]);
      const app = createTestApp({
        actor: null,
        dataService: createDataServiceMock({ getActivityById, listAttachments }),
      });

      const response = await app.request(
        `/api/public/attachments?scope=activity&resourceId=${IDs.activity}`,
      );

      expect(response.status).toBe(200);
      const body = await readJson<{ data: AttachmentEntity[] }>(response);
      expect(body.data).toEqual([]);
      expect(getActivityById).toHaveBeenCalledWith(IDs.activity);
      expect(listAttachments).not.toHaveBeenCalled();
    });

    it("잘못된 resourceId는 400을 반환한다", async () => {
      const app = createTestApp({
        actor: null,
        dataService: createDataServiceMock(),
      });

      const response = await app.request(
        "/api/public/attachments?scope=activity&resourceId=not-a-uuid",
      );

      expect(response.status).toBe(400);
      await expectErrorCode(response, "BAD_REQUEST");
    });
  });
});
