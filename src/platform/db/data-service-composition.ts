import createDB from "../../lib/db";
import type { DataService } from "../../lib/services/types";
import { createActivityRepository } from "../../features/activities/activity.repository";
import { createAttachmentRepository } from "../../features/attachments/attachment.repository";
import { createAuditRepository } from "../../features/audit/audit.repository";
import { createDashboardReadRepository } from "../../features/dashboard/dashboard-read.repository";
import { createExhibitionRepository } from "../../features/exhibitions/exhibition.repository";
import { createGenerationRepository } from "../../features/generations/generation.repository";
import { createLinktreeRepository } from "../../features/linktree/linktree.repository";
import { createPageViewRepository } from "../../features/page-views/page-view.repository";
import { createRecruitingPlanRepository } from "../../features/recruiting-plan/recruiting-plan.repository";
import { createSiteSettingsRepository } from "../../features/site-settings/site-settings.repository";
import { createUserRepository } from "../../features/users/user.repository";

/**
 * 영속화 구현은 각 feature의 repository가 소유한다. 이 파일은 그것들을 하나의
 * `DataService` 파사드로 조립하기만 하는 composition root다.
 *
 * `DataService`는 route 계층이 아직 feature repository를 직접 받지 않기 때문에 남아 있는
 * 호환 계층이다. feature가 필요한 repository만 주입받도록 옮겨질수록 이 파사드는 얇아진다.
 */
export const createDbDataService = (database: D1Database): DataService => {
  const db = createDB(database);
  const auditRepository = createAuditRepository(db);
  const generationRepository = createGenerationRepository(db);
  const activityRepository = createActivityRepository(db, database);
  const exhibitionRepository = createExhibitionRepository(db, database);
  const linktreeRepository = createLinktreeRepository(db);
  const attachmentRepository = createAttachmentRepository(db);
  const siteSettingsRepository = createSiteSettingsRepository(db);
  const recruitingPlanRepository = createRecruitingPlanRepository(db);
  const userRepository = createUserRepository(db);
  const dashboardReadRepository = createDashboardReadRepository(db);
  const pageViewRepository = createPageViewRepository(db);
  return {
    createAuditLog: auditRepository.recordAuditLog,
    listAuditLogs: auditRepository.listAuditLogs,
    getLatestAuditActor: auditRepository.getLatestAuditActor,
    listLatestAuditActors: auditRepository.listLatestAuditActors,

    listGenerations: generationRepository.listGenerations,
    createGeneration: generationRepository.createGeneration,
    getGenerationById: generationRepository.getGenerationById,
    updateGeneration: generationRepository.updateGeneration,
    deleteGeneration: generationRepository.deleteGeneration,

    listActivities: activityRepository.listActivities,
    listPublicActivities: activityRepository.listPublicActivities,
    createActivity: activityRepository.createActivity,
    getActivityById: activityRepository.getActivityById,
    updateActivity: activityRepository.updateActivity,
    deleteActivity: activityRepository.deleteActivity,
    addActivityImage: activityRepository.addActivityImage,
    addActivityImages: activityRepository.addActivityImages,
    updateActivityImage: activityRepository.updateActivityImage,
    updateActivityImages: activityRepository.updateActivityImages,
    deleteActivityImage: activityRepository.deleteActivityImage,

    listExhibitions: exhibitionRepository.listExhibitions,
    listPublicExhibitions: exhibitionRepository.listPublicExhibitions,
    createExhibition: exhibitionRepository.createExhibition,
    getExhibitionById: exhibitionRepository.getExhibitionById,
    updateExhibition: exhibitionRepository.updateExhibition,
    deleteExhibition: exhibitionRepository.deleteExhibition,
    addExhibitionImage: exhibitionRepository.addExhibitionImage,
    addExhibitionImages: exhibitionRepository.addExhibitionImages,
    updateExhibitionImage: exhibitionRepository.updateExhibitionImage,
    updateExhibitionImages: exhibitionRepository.updateExhibitionImages,
    deleteExhibitionImage: exhibitionRepository.deleteExhibitionImage,

    listLinktrees: linktreeRepository.listLinktrees,
    createLinktree: linktreeRepository.createLinktree,
    getLinktreeById: linktreeRepository.getLinktreeById,
    updateLinktree: linktreeRepository.updateLinktree,
    deleteLinktree: linktreeRepository.deleteLinktree,
    addLinktreeItem: linktreeRepository.addLinktreeItem,
    updateLinktreeItem: linktreeRepository.updateLinktreeItem,
    deleteLinktreeItem: linktreeRepository.deleteLinktreeItem,

    listAttachments: attachmentRepository.listAttachments,
    getAttachmentById: attachmentRepository.getAttachmentById,
    addAttachment: attachmentRepository.addAttachment,
    updateAttachment: attachmentRepository.updateAttachment,
    deleteAttachment: attachmentRepository.deleteAttachment,

    getSiteSettings: siteSettingsRepository.getSiteSettings,
    updateSiteSettings: siteSettingsRepository.updateSiteSettings,

    getCurrentRecruitingPlan: recruitingPlanRepository.getCurrentRecruitingPlan,
    upsertCurrentRecruitingPlan:
      recruitingPlanRepository.upsertCurrentRecruitingPlan,

    listUsers: userRepository.listUsers,
    listUsersByIds: userRepository.listUsersByIds,
    listUsersByGenerationIds: userRepository.listUsersByGenerationIds,
    countUsersByRole: userRepository.countUsersByRole,
    getUserById: userRepository.getUserById,
    listUserResourceHistory: userRepository.listUserResourceHistory,
    updateUser: userRepository.updateUser,
    bulkUpdateUsersRole: userRepository.bulkUpdateUsersRole,
    deleteUser: userRepository.deleteUser,

    getAdminDashboardStats: dashboardReadRepository.getAdminDashboardStats,

    isActiveViewResource: pageViewRepository.isActiveViewResource,
    recordPageView: pageViewRepository.recordPageView,
    getPageViewStats: pageViewRepository.getPageViewStats,
    getDashboardPageViewStats: pageViewRepository.getDashboardPageViewStats,
  };
};
