import { z } from "../../shared/openapi/zod";
import {
  EXAMPLE_AUDIT_ID,
  EXAMPLE_GENERATION_ID,
  EXAMPLE_PARENT_ID,
  EXAMPLE_TIMESTAMP_MS,
  EXAMPLE_TIMESTAMP_MS_END,
  EXAMPLE_USER_ID,
  httpUrlInputField,
  phoneNumberField,
  studentNumberField,
  timestampField,
  urlField,
} from "../../shared/openapi/field-builders";
import { KOREAN_MOBILE_PHONE_REGEX } from "../../shared/auth/profile";
import { ApiAuditActorSchema } from "../audit/audit.contract";

const ApiShowcaseImageUrlsSchema = z
  .array(
    urlField(
      "대표 작품 사진 URL",
      "https://cdn.yonyoung.example/users/profile/showcase-1.jpg",
    ),
  )
  .max(10, "대표 작품 사진은 최대 10장까지 등록할 수 있습니다.")
  .refine((items) => new Set(items).size === items.length, {
    message: "중복된 showcaseImageUrls를 전달할 수 없습니다.",
  });

const ApiShowcaseImageUrlsInputSchema = z
  .array(
    httpUrlInputField(
      "대표 작품 사진 URL",
      "https://cdn.yonyoung.example/users/profile/showcase-1.jpg",
    ),
  )
  .max(10, "대표 작품 사진은 최대 10장까지 등록할 수 있습니다.")
  .refine((items) => new Set(items).size === items.length, {
    message: "중복된 showcaseImageUrls를 전달할 수 없습니다.",
  });

export const ApiUserSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "사용자 UUID",
      example: EXAMPLE_USER_ID,
    }),
    name: z.string().openapi({
      description: "사용자 이름",
      example: "홍길동",
    }),
    email: z.string().email().openapi({
      description: "사용자 이메일",
      example: "regular_member@yonyoung.example",
    }),
    image: z.string().url().nullable().openapi({
      description: "프로필 이미지 URL (없으면 null)",
      example: "https://cdn.yonyoung.example/users/profile/member.png",
    }),
    showcaseImageUrls: ApiShowcaseImageUrlsSchema.openapi({
      description: "대표 작품 사진 URL 목록 (최대 10장)",
      example: [
        "https://cdn.yonyoung.example/users/profile/showcase-1.jpg",
        "https://cdn.yonyoung.example/users/profile/showcase-2.jpg",
      ],
    }),
    familyName: z.string().nullable().openapi({
      description: "성 (없으면 null)",
      example: "김",
    }),
    givenName: z.string().nullable().openapi({
      description: "이름 (없으면 null)",
      example: "민수",
    }),
    college: z.string().nullable().openapi({
      description: "대학명 (예: 공과대학, 없으면 null)",
      example: "공과대학",
    }),
    department: z.string().nullable().openapi({
      description: "학과명 (없으면 null)",
      example: "컴퓨터과학과",
    }),
    studentNumber: z.string().nullable().openapi({
      description: "학번 10자리 (없으면 null)",
      example: "2026000123",
    }),
    phoneNumber: z.string().nullable().openapi({
      description: "전화번호 (없으면 null)",
      example: "010-1234-5678",
    }),
    collaborationAvailable: z.boolean().openapi({
      description: "협업 가능 여부 (true/false)",
      example: true,
    }),
    personalLink: z.string().url().nullable().openapi({
      description: "개인 링크 URL (없으면 null)",
      example: "https://example.com/my-portfolio",
    }),
    role: z.string().nullable().openapi({
      description: "원본 사용자 역할 문자열 (없으면 null)",
      example: "regular_member",
    }),
    generationId: z.string().uuid().nullable().openapi({
      description: "소속 기수 UUID (없으면 null)",
      example: EXAMPLE_GENERATION_ID,
    }),
    generationIds: z.array(z.string().uuid()).openapi({
      description: "소속 기수 UUID 목록 (다중 소속 가능, 없으면 빈 배열)",
      example: [EXAMPLE_GENERATION_ID],
    }),
    createdAt: timestampField("사용자 생성 시각", EXAMPLE_TIMESTAMP_MS),
    updatedAt: timestampField("사용자 수정 시각", EXAMPLE_TIMESTAMP_MS),
    updatedBy: ApiAuditActorSchema.nullable().openapi({
      description: "마지막 수정자 정보 (로그가 없으면 null)",
    }),
  })
  .openapi("ApiUser");

const ApiUserResourceHistoryResourceTypeSchema = z
  .enum(["activity", "exhibition", "linktree", "linktree_item"])
  .openapi("ApiUserResourceHistoryResourceType");

const ApiUserResourceHistoryItemSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "감사 로그 UUID",
      example: EXAMPLE_AUDIT_ID,
    }),
    resourceType: ApiUserResourceHistoryResourceTypeSchema.openapi({
      description: "이력 리소스 타입",
      example: "activity",
    }),
    resourceId: z.string().openapi({
      description: "변경 대상 리소스 ID",
      example: EXAMPLE_PARENT_ID,
    }),
    resourceTitle: z.string().nullable().openapi({
      description: "리소스 표시 이름(조회 불가/삭제 등으로 없으면 null)",
      example: "정기 워크숍",
    }),
    action: z.enum(["create", "update", "delete"]).openapi({
      description: "수행된 액션",
      example: "update",
    }),
    changedFields: z.array(z.string()).openapi({
      description: "변경 필드 목록",
      example: ["title", "updatedAt"],
    }),
    isDeleted: z.boolean().openapi({
      description: "현재 리소스 삭제 여부(소프트 삭제 포함)",
      example: false,
    }),
    generationId: z.string().uuid().nullable().openapi({
      description: "기수 기반 리소스(activity/exhibition)의 기수 UUID",
      example: EXAMPLE_GENERATION_ID,
    }),
    linktreeId: z.string().uuid().nullable().openapi({
      description: "linktree_item 리소스일 때 상위 linktree UUID",
      example: EXAMPLE_PARENT_ID,
    }),
    createdAt: timestampField("이력 기록 시각", EXAMPLE_TIMESTAMP_MS),
  })
  .openapi("ApiUserResourceHistoryItem");

export const ApiUserResourceHistorySchema = z
  .object({
    items: z.array(ApiUserResourceHistoryItemSchema).openapi({
      description: "사용자 리소스 이력 배열(최신순)",
    }),
    page: z.number().int().min(1).openapi({
      description: "현재 페이지 번호(1부터 시작)",
      example: 1,
    }),
    pageSize: z.number().int().min(1).openapi({
      description: "페이지당 이력 수",
      example: 10,
    }),
    total: z.number().int().min(0).openapi({
      description: "조건에 맞는 전체 이력 수",
      example: 24,
    }),
    totalPages: z.number().int().min(0).openapi({
      description: "전체 페이지 수",
      example: 3,
    }),
  })
  .openapi("ApiUserResourceHistory");

export const ApiUserResourceHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({
      description: "조회할 페이지 번호(기본 1)",
      example: 1,
    }),
    pageSize: z.coerce.number().int().min(1).max(100).default(10).openapi({
      description: "페이지당 조회할 최대 이력 수(기본 10, 최대 100)",
      example: 10,
    }),
    action: z.enum(["create", "update", "delete"]).optional().openapi({
      description: "특정 액션만 필터링할 때 사용",
      example: "create",
    }),
  })
  .openapi("ApiUserResourceHistoryQuery");

const ApiPublicGenerationMemberSchema = z
  .object({
    id: z.string().openapi({
      description: "사용자 식별자 (better-auth user.id)",
      example: EXAMPLE_USER_ID,
    }),
    name: z.string().openapi({
      description: "레거시 표시 이름",
      example: "홍길동",
    }),
    image: z.string().url().nullable().openapi({
      description: "프로필 이미지 URL (없으면 null)",
      example: "https://cdn.yonyoung.example/users/profile/member.png",
    }),
    showcaseImageUrls: ApiShowcaseImageUrlsSchema.openapi({
      description: "대표 작품 사진 URL 목록 (최대 10장)",
      example: [
        "https://cdn.yonyoung.example/users/profile/showcase-1.jpg",
        "https://cdn.yonyoung.example/users/profile/showcase-2.jpg",
      ],
    }),
    familyName: z.string().nullable().openapi({
      description: "성 (없으면 null)",
      example: "김",
    }),
    givenName: z.string().nullable().openapi({
      description: "이름 (없으면 null)",
      example: "민수",
    }),
    collaborationAvailable: z.boolean().openapi({
      description: "협업 가능 여부 (true/false)",
      example: true,
    }),
    personalLink: z.string().url().nullable().openapi({
      description: "개인 링크 URL (없으면 null)",
      example: "https://example.com/my-portfolio",
    }),
    role: z.string().nullable().openapi({
      description: "역할 문자열 (없으면 null)",
      example: "regular_member",
    }),
    generationId: z.string().uuid().openapi({
      description: "소속 기수 UUID",
      example: EXAMPLE_GENERATION_ID,
    }),
  })
  .openapi("ApiPublicGenerationMember");

export const ApiGenerationMemberSummarySchema = z
  .object({
    id: z.string().openapi({
      description: "사용자 식별자 (better-auth user.id)",
      example: EXAMPLE_USER_ID,
    }),
    generationId: z.string().uuid().openapi({
      description: "조회 기준 기수 UUID",
      example: EXAMPLE_GENERATION_ID,
    }),
    name: z.string().openapi({
      description: "레거시 표시 이름",
      example: "홍길동",
    }),
    image: z.string().url().nullable().openapi({
      description: "프로필 이미지 URL (없으면 null)",
      example: "https://cdn.yonyoung.example/users/profile/member.png",
    }),
    familyName: z.string().nullable().openapi({
      description: "성 (없으면 null)",
      example: "김",
    }),
    givenName: z.string().nullable().openapi({
      description: "이름 (없으면 null)",
      example: "민수",
    }),
    department: z.string().nullable().openapi({
      description: "학과명 (없으면 null)",
      example: "컴퓨터과학과",
    }),
    collaborationAvailable: z.boolean().openapi({
      description: "협업 가능 여부 (true/false)",
      example: true,
    }),
    personalLink: z.string().url().nullable().openapi({
      description: "개인 링크 URL (없으면 null)",
      example: "https://example.com/my-portfolio",
    }),
    role: z.string().nullable().openapi({
      description: "역할 문자열 (없으면 null)",
      example: "regular_member",
    }),
  })
  .openapi("ApiGenerationMemberSummary");

export const ApiPublicGenerationWithMembersSchema = z
  .object({
    id: z.string().uuid().openapi({
      description: "기수 UUID",
      example: EXAMPLE_GENERATION_ID,
    }),
    name: z.string().openapi({
      description: "기수 이름",
      example: "60기",
    }),
    sortOrder: z.number().int().openapi({
      description: "기수 정렬 순서",
      example: 60,
    }),
    startDate: timestampField("기수 시작일시", EXAMPLE_TIMESTAMP_MS),
    endDate: timestampField("기수 종료일시", EXAMPLE_TIMESTAMP_MS_END),
    members: z.array(ApiPublicGenerationMemberSchema).openapi({
      description: "해당 기수 소속 공개 멤버 목록",
    }),
  })
  .openapi("ApiPublicGenerationWithMembers");

export const ApiAdminUpdateUserSchema = z
  .object({
    name: z.string().min(1).optional().openapi({
      description: "사용자 이름(관리자 수정 가능)",
      example: "홍길동",
    }),
    image: httpUrlInputField(
      "프로필 이미지 URL(관리자 수정 가능)",
      "https://cdn.yonyoung.example/users/profile/member-new.png",
    )
      .nullable()
      .optional(),
    showcaseImageUrls: ApiShowcaseImageUrlsInputSchema.optional().openapi({
      description: "대표 작품 사진 URL 목록(관리자 수정 가능, 최대 10장)",
      example: ["https://cdn.yonyoung.example/users/profile/showcase-1.jpg"],
    }),
    familyName: z
      .string()
      .trim()
      .min(1, "성은 비워둘 수 없습니다.")
      .nullable()
      .optional()
      .openapi({
        description: "성(관리자 수정 가능)",
        example: "김",
      }),
    givenName: z
      .string()
      .trim()
      .min(1, "이름은 비워둘 수 없습니다.")
      .nullable()
      .optional()
      .openapi({
        description: "이름(관리자 수정 가능)",
        example: "민수",
      }),
    college: z
      .string()
      .trim()
      .min(1, "대학명은 비워둘 수 없습니다.")
      .nullable()
      .optional()
      .openapi({
        description: "대학명(관리자 수정 가능, 예: 공과대학)",
        example: "공과대학",
      }),
    department: z
      .string()
      .trim()
      .min(1, "학과명은 비워둘 수 없습니다.")
      .nullable()
      .optional()
      .openapi({
        description: "학과명(관리자 수정 가능)",
        example: "컴퓨터과학과",
      }),
    studentNumber: studentNumberField(
      "학번 10자리(관리자 수정 가능)",
      "2026000123",
    )
      .nullable()
      .optional(),
    phoneNumber: phoneNumberField("전화번호(관리자 수정 가능)", "010-1234-5678")
      .nullable()
      .optional(),
    collaborationAvailable: z.boolean().optional().openapi({
      description: "협업 가능 여부(true/false, 관리자 수정 가능)",
      example: true,
    }),
    personalLink: httpUrlInputField(
      "개인 링크 URL(관리자 수정 가능)",
      "https://example.com/my-portfolio",
    )
      .nullable()
      .optional(),
    role: z
      .enum([
        "president",
        "vice_president",
        "manager",
        "new_member",
        "associate_member",
        "regular_member",
        "unverified",
      ])
      .optional()
      .openapi({
        description:
          "역할 문자열(관리자 전용). 기본 가입 역할은 `unverified`이며, 승인 시 member 계열 role(`new_member`/`associate_member`/`regular_member`)로 변경할 수 있습니다.",
        example: "manager",
      }),
    generationId: z.string().uuid().nullable().optional().openapi({
      description: "소속 기수 UUID(관리자 수정 가능)",
      example: EXAMPLE_GENERATION_ID,
    }),
    generationIds: z
      .array(z.string().uuid("generationIds 항목 형식이 올바르지 않습니다."))
      .optional()
      .openapi({
        description:
          "소속 기수 UUID 목록(관리자 수정 가능). 전달 시 기존 소속을 전체 교체합니다.",
        example: [EXAMPLE_GENERATION_ID],
      }),
  })
  .strict()
  .openapi("ApiAdminUpdateUserInput");

export const ApiMemberProfileUpdateSchema = z
  .object({
    image: httpUrlInputField(
      "본인 프로필 이미지 URL 수정",
      "https://cdn.yonyoung.example/users/profile/member-self.png",
    )
      .nullable()
      .optional(),
    showcaseImageUrls: ApiShowcaseImageUrlsInputSchema.optional().openapi({
      description: "본인 대표 작품 사진 URL 목록 수정 (최대 10장)",
      example: ["https://cdn.yonyoung.example/users/profile/showcase-1.jpg"],
    }),
    familyName: z
      .string()
      .trim()
      .min(1, "성은 비워둘 수 없습니다.")
      .nullable()
      .optional()
      .openapi({
        description: "본인 성 수정",
        example: "김",
      }),
    givenName: z
      .string()
      .trim()
      .min(1, "이름은 비워둘 수 없습니다.")
      .nullable()
      .optional()
      .openapi({
        description: "본인 이름 수정",
        example: "민수",
      }),
    college: z
      .string()
      .trim()
      .min(1, "대학명은 비워둘 수 없습니다.")
      .nullable()
      .optional()
      .openapi({
        description: "본인 대학명 수정 (예: 공과대학)",
        example: "공과대학",
      }),
    department: z
      .string()
      .trim()
      .min(1, "학과명은 비워둘 수 없습니다.")
      .nullable()
      .optional()
      .openapi({
        description: "본인 학과명 수정",
        example: "컴퓨터과학과",
      }),
    studentNumber: studentNumberField("본인 학번 10자리 수정", "2026000123")
      .nullable()
      .optional(),
    phoneNumber: z
      .string()
      .trim()
      .regex(
        KOREAN_MOBILE_PHONE_REGEX,
        "전화번호는 010-1234-5678 형식이어야 합니다.",
      )
      .nullable()
      .optional()
      .openapi({
        description: "본인 전화번호 수정",
        example: "010-1234-5678",
      }),
    collaborationAvailable: z.boolean().optional().openapi({
      description: "본인 협업 가능 여부 수정(true/false)",
      example: true,
    }),
    personalLink: httpUrlInputField(
      "본인 개인 링크 URL 수정",
      "https://example.com/my-portfolio",
    )
      .nullable()
      .optional(),
  })
  .strict()
  .openapi("ApiMemberProfileUpdateInput");

const ApiAdminAssignableRoleSchema = z.enum([
  "president",
  "vice_president",
  "manager",
  "new_member",
  "associate_member",
  "regular_member",
  "unverified",
]);

export const ApiBulkUpdateUserRoleSchema = z
  .object({
    userIds: z
      .array(
        z
          .string()
          .min(1)
          .regex(
            /^[A-Za-z0-9_-]+$/,
            "사용자 식별자는 영문/숫자/하이픈/언더스코어만 사용할 수 있습니다.",
          ),
      )
      .min(1, "사용자 ID를 하나 이상 전달해야 합니다.")
      .max(200, "한 번에 변경 가능한 사용자 수는 최대 200명입니다.")
      .openapi({
        description: "일괄 권한 변경 대상 사용자 ID 목록",
        example: [EXAMPLE_USER_ID],
      }),
    role: ApiAdminAssignableRoleSchema.openapi({
      description: "변경할 역할",
      example: "regular_member",
    }),
  })
  .strict()
  .openapi("ApiBulkUpdateUserRoleInput");
