export type GenerationEntity = {
  id: string;
  name: string;
  sortOrder: number;
  startDate: Date;
  endDate: Date;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: AuditActorEntity | null;
};

export type AuditResourceType =
  | "generation"
  | "activity"
  | "exhibition"
  | "linktree"
  | "linktree_item"
  | "user"
  | "attachment";

export type AuditAction = "create" | "update" | "delete";

export type AuditActorEntity = {
  id: string;
  name: string;
  familyName: string | null;
  givenName: string | null;
  role: string | null;
};

export type AuditLogEntity = {
  id: string;
  resourceType: AuditResourceType;
  resourceId: string;
  action: AuditAction;
  actor: AuditActorEntity | null;
  changedFields: string[];
  createdAt: Date;
};

export type ActivityImageEntity = {
  id: string;
  activityId: string;
  imageUrl: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ActivityEntity = {
  id: string;
  title: string;
  description: string;
  startDate: Date;
  endDate: Date;
  coverImageUrl: string;
  generationId: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: AuditActorEntity | null;
  detailImages: ActivityImageEntity[];
};

export type ExhibitionImageEntity = {
  id: string;
  exhibitionId: string;
  imageUrl: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ExhibitionEntity = {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  generationId: string;
  place: string;
  coverImageUrl: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: AuditActorEntity | null;
  detailImages: ExhibitionImageEntity[];
};

export type LinktreeItemEntity = {
  id: string;
  linktreeId: string;
  name: string;
  link: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: AuditActorEntity | null;
};

export type LinktreeEntity = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: AuditActorEntity | null;
  items: LinktreeItemEntity[];
};

export type AttachmentScope = "activity" | "site_donate";

/** 파일 첨부(fileUrl 세트)와 외부 링크(linkUrl) 중 정확히 하나만 값이 채워진다. */
export type AttachmentEntity = {
  id: string;
  scope: AttachmentScope;
  resourceId: string | null;
  title: string;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  linkUrl: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateAttachmentInput = {
  scope: AttachmentScope;
  resourceId: string | null;
  title: string;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  linkUrl: string | null;
  sortOrder: number;
};

export type SiteSettingsEntity = {
  footerOpenChatUrl: string;
  footerInstagramId: string;
  footerEmail: string;
  footerPhone: string;
  footerAddress: string;
  donateBankName: string;
  donateAccountNumber: string;
  donateAccountHolder: string;
};

export type RecruitingPlanEntity = {
  year: number;
  title: string;
  content: string;
  promotionImageUrls: string[];
  recruitmentStartAt: Date;
  recruitmentEndAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type UserEntity = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  showcaseImageUrls: string[];
  familyName: string | null;
  givenName: string | null;
  college: string | null;
  department: string | null;
  studentNumber: string | null;
  phoneNumber: string | null;
  collaborationAvailable: boolean;
  personalLink: string | null;
  role: string | null;
  generationId: string | null;
  generationIds?: string[];
  createdAt: Date;
  updatedAt: Date;
  updatedBy: AuditActorEntity | null;
};

export type UserResourceHistoryResourceType =
  | "activity"
  | "exhibition"
  | "linktree"
  | "linktree_item";

export type UserResourceHistoryItemEntity = {
  id: string;
  resourceType: UserResourceHistoryResourceType;
  resourceId: string;
  resourceTitle: string | null;
  action: AuditAction;
  changedFields: string[];
  isDeleted: boolean;
  generationId: string | null;
  linktreeId: string | null;
  createdAt: Date;
};

export type UserResourceHistoryEntity = {
  items: UserResourceHistoryItemEntity[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type AdminDashboardStatsEntity = {
  usersTotal: number;
  unverifiedUsersTotal: number;
  generationsTotal: number;
  selectedGenerationMembersTotal: number;
  selectedGenerationActivitiesTotal: number;
  selectedGenerationExhibitionsTotal: number;
  linktreeLinksTotal: number;
};

export type PageViewStatsEntity = {
  totalViews: number;
  homeViews: number;
  activityViews: number;
  exhibitionViews: number;
  noticeViews: number;
  topActivities: Array<{ resourceId: string; count: number }>;
  topExhibitions: Array<{ resourceId: string; count: number }>;
  dailyTrend: Array<{ date: string; count: number }>;
};

export type DashboardPageViewStatsEntity = {
  today: {
    count: number;
    prevCount: number; // yesterday
  };
  thisWeek: {
    count: number;
    prevCount: number; // last week
  };
  dailyTrend: Array<{
    date: string;
    count: number;
  }>;
};

export type DataService = {
  createAuditLog: (input: {
    resourceType: AuditResourceType;
    resourceId: string;
    action: AuditAction;
    actorId: string | null;
    actorName: string;
    actorRole: string | null;
    changedFields: string[];
  }) => Promise<void>;
  listAuditLogs: (
    resourceType: AuditResourceType,
    resourceId: string,
    limit: number,
  ) => Promise<AuditLogEntity[]>;
  getLatestAuditActor: (
    resourceType: AuditResourceType,
    resourceId: string,
  ) => Promise<AuditActorEntity | null>;
  listLatestAuditActors: (
    resourceType: AuditResourceType,
    resourceIds: string[],
  ) => Promise<Record<string, AuditActorEntity | null>>;

  listGenerations: () => Promise<GenerationEntity[]>;
  createGeneration: (input: {
    name: string;
    sortOrder: number;
    startDate: number;
    endDate: number;
  }) => Promise<GenerationEntity>;
  getGenerationById: (id: string) => Promise<GenerationEntity | null>;
  updateGeneration: (
    id: string,
    input: Partial<{
      name: string;
      sortOrder: number;
      startDate: number;
      endDate: number;
    }>,
  ) => Promise<GenerationEntity | null>;
  deleteGeneration: (id: string) => Promise<boolean>;

  listActivities: (generationId?: string) => Promise<ActivityEntity[]>;
  listPublicActivities: () => Promise<ActivityEntity[]>;
  createActivity: (input: {
    title: string;
    description: string;
    startDate: number;
    endDate: number;
    coverImageUrl: string;
    generationId: string;
  }) => Promise<ActivityEntity>;
  getActivityById: (id: string) => Promise<ActivityEntity | null>;
  updateActivity: (
    id: string,
    input: Partial<{
      title: string;
      description: string;
      startDate: number;
      endDate: number;
      coverImageUrl: string;
      generationId: string;
    }>,
  ) => Promise<ActivityEntity | null>;
  deleteActivity: (id: string) => Promise<boolean>;
  addActivityImage: (
    activityId: string,
    input: { imageUrl: string; sortOrder: number },
  ) => Promise<ActivityImageEntity | null>;
  addActivityImages: (
    activityId: string,
    input: Array<{ imageUrl: string; sortOrder: number }>,
  ) => Promise<ActivityImageEntity[] | null>;
  updateActivityImage: (
    activityId: string,
    imageId: string,
    input: Partial<{ imageUrl: string; sortOrder: number }>,
  ) => Promise<ActivityImageEntity | null>;
  updateActivityImages: (
    activityId: string,
    input: Array<{
      imageId: string;
      imageUrl?: string;
      sortOrder?: number;
    }>,
  ) => Promise<ActivityImageEntity[] | null>;
  deleteActivityImage: (activityId: string, imageId: string) => Promise<boolean>;

  listExhibitions: (generationId?: string) => Promise<ExhibitionEntity[]>;
  listPublicExhibitions: () => Promise<ExhibitionEntity[]>;
  createExhibition: (input: {
    title: string;
    startDate: number;
    endDate: number;
    generationId: string;
    place: string;
    coverImageUrl: string;
    description: string;
  }) => Promise<ExhibitionEntity>;
  getExhibitionById: (id: string) => Promise<ExhibitionEntity | null>;
  updateExhibition: (
    id: string,
    input: Partial<{
      title: string;
      startDate: number;
      endDate: number;
      generationId: string;
      place: string;
      coverImageUrl: string;
      description: string;
    }>,
  ) => Promise<ExhibitionEntity | null>;
  deleteExhibition: (id: string) => Promise<boolean>;
  addExhibitionImage: (
    exhibitionId: string,
    input: { imageUrl: string; sortOrder: number },
  ) => Promise<ExhibitionImageEntity | null>;
  addExhibitionImages: (
    exhibitionId: string,
    input: Array<{ imageUrl: string; sortOrder: number }>,
  ) => Promise<ExhibitionImageEntity[] | null>;
  updateExhibitionImage: (
    exhibitionId: string,
    imageId: string,
    input: Partial<{ imageUrl: string; sortOrder: number }>,
  ) => Promise<ExhibitionImageEntity | null>;
  updateExhibitionImages: (
    exhibitionId: string,
    input: Array<{
      imageId: string;
      imageUrl?: string;
      sortOrder?: number;
    }>,
  ) => Promise<ExhibitionImageEntity[] | null>;
  deleteExhibitionImage: (
    exhibitionId: string,
    imageId: string,
  ) => Promise<boolean>;

  listLinktrees: () => Promise<LinktreeEntity[]>;
  createLinktree: (input: { name: string }) => Promise<LinktreeEntity>;
  getLinktreeById: (id: string) => Promise<LinktreeEntity | null>;
  updateLinktree: (
    id: string,
    input: Partial<{ name: string }>,
  ) => Promise<LinktreeEntity | null>;
  deleteLinktree: (id: string) => Promise<boolean>;
  addLinktreeItem: (
    linktreeId: string,
    input: { name: string; link: string },
  ) => Promise<LinktreeItemEntity | null>;
  updateLinktreeItem: (
    linktreeId: string,
    itemId: string,
    input: Partial<{ name: string; link: string }>,
  ) => Promise<LinktreeItemEntity | null>;
  deleteLinktreeItem: (linktreeId: string, itemId: string) => Promise<boolean>;

  listAttachments: (
    scope: AttachmentScope,
    resourceId: string | null,
  ) => Promise<AttachmentEntity[]>;
  getAttachmentById: (id: string) => Promise<AttachmentEntity | null>;
  addAttachment: (
    input: CreateAttachmentInput,
  ) => Promise<AttachmentEntity | null>;
  updateAttachment: (
    id: string,
    input: Partial<{ title: string; sortOrder: number }>,
  ) => Promise<AttachmentEntity | null>;
  deleteAttachment: (id: string) => Promise<boolean>;

  getSiteSettings: () => Promise<SiteSettingsEntity>;
  updateSiteSettings: (
    input: Partial<{
      footerOpenChatUrl: string;
      footerInstagramId: string;
      footerEmail: string;
      footerPhone: string;
      footerAddress: string;
      donateBankName: string;
      donateAccountNumber: string;
      donateAccountHolder: string;
    }>,
  ) => Promise<SiteSettingsEntity>;

  getCurrentRecruitingPlan: () => Promise<RecruitingPlanEntity | null>;
  upsertCurrentRecruitingPlan: (input: {
    title: string;
    content: string;
    promotionImageUrls: string[];
    recruitmentStartAt: Date;
    recruitmentEndAt: Date;
  }) => Promise<RecruitingPlanEntity>;

  listUsers: () => Promise<UserEntity[]>;
  listUsersByIds: (userIds: string[]) => Promise<UserEntity[]>;
  listUsersByGenerationIds: (generationIds: string[]) => Promise<UserEntity[]>;
  countUsersByRole: (role: string) => Promise<number>;
  getUserById: (id: string) => Promise<UserEntity | null>;
  listUserResourceHistory: (input: {
    userId: string;
    page: number;
    pageSize: number;
    action?: AuditAction;
  }) => Promise<UserResourceHistoryEntity>;
  updateUser: (
    id: string,
    input: Partial<{
      name: string;
      image: string | null;
      showcaseImageUrls: string[];
      familyName: string | null;
      givenName: string | null;
      college: string | null;
      department: string | null;
      studentNumber: string | null;
      phoneNumber: string | null;
      collaborationAvailable: boolean;
      personalLink: string | null;
      role: string;
      generationIds: string[];
      generationId: string | null;
    }>,
  ) => Promise<UserEntity | null>;
  bulkUpdateUsersRole: (input: {
    userIds: string[];
    role: string;
  }) => Promise<UserEntity[]>;
  getAdminDashboardStats: (generationSortOrder: number | null) => Promise<AdminDashboardStatsEntity>;
  recordPageView: (pageType: string, resourceId: string | undefined) => Promise<void>;
  getPageViewStats: () => Promise<PageViewStatsEntity>;
  getDashboardPageViewStats: () => Promise<DashboardPageViewStatsEntity>;
  deleteUser: (id: string) => Promise<boolean>;
};

export type PresignService = {
  issuePresignedPutUrl: (input: {
    actorId: string;
    resource: "activities" | "exhibitions" | "users" | "notices" | "site";
    slot: "cover" | "detail" | "profile" | "image" | "file";
    fileName: string;
    contentType: string;
    fileSize: number;
  }) => Promise<{
    uploadUrl: string;
    objectKey: string;
    publicUrl: string;
    requiredHeaders: Record<string, string>;
  }>;
  initiateMultipartUpload: (input: {
    actorId: string;
    resource: "activities" | "exhibitions" | "users" | "notices" | "site";
    slot: "cover" | "detail" | "profile" | "image" | "file";
    fileName: string;
    contentType: string;
    fileSize: number;
  }) => Promise<{
    uploadId: string;
    objectKey: string;
    publicUrl: string;
    partSize: number;
    maxPartNumber: number;
  }>;
  issueMultipartUploadPartUrl: (input: {
    uploadId: string;
    objectKey: string;
    partNumber: number;
  }) => Promise<{
    uploadUrl: string;
    requiredHeaders: Record<string, string>;
  }>;
  completeMultipartUpload: (input: {
    uploadId: string;
    objectKey: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }) => Promise<{
    objectKey: string;
    publicUrl: string;
  }>;
  abortMultipartUpload: (input: {
    uploadId: string;
    objectKey: string;
  }) => Promise<void>;
};
