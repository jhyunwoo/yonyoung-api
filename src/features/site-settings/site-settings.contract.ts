import { z } from "../../shared/openapi/zod";
import {
  httpUrlInputField,
  phoneNumberField,
  urlField,
} from "../../shared/openapi/field-builders";
import { DEFAULT_SITE_SETTINGS } from "../../shared/api-contracts";

const ApiInstagramIdFieldSchema = z
  .string()
  .trim()
  .min(1, "인스타그램 아이디는 비워둘 수 없습니다.")
  .regex(
    /^@?[A-Za-z0-9._]+$/,
    "인스타그램 아이디는 영문, 숫자, 점(.), 밑줄(_)만 사용할 수 있습니다.",
  );

export const ApiSiteSettingsSchema = z
  .object({
    footerOpenChatUrl: urlField(
      "footer 오픈 카톡방 링크",
      DEFAULT_SITE_SETTINGS.footerOpenChatUrl,
    ),
    footerInstagramId: ApiInstagramIdFieldSchema.openapi({
      description: "footer 인스타그램 아이디 (@ 제외 저장 권장)",
      example: DEFAULT_SITE_SETTINGS.footerInstagramId,
    }),
    footerEmail: z
      .string()
      .trim()
      .email("이메일 형식이 올바르지 않습니다.")
      .openapi({
        description: "footer 이메일 주소",
        example: DEFAULT_SITE_SETTINGS.footerEmail,
      }),
    footerPhone: phoneNumberField(
      "footer 전화번호",
      DEFAULT_SITE_SETTINGS.footerPhone,
    ),
    footerAddress: z
      .string()
      .trim()
      .min(1, "주소는 비워둘 수 없습니다.")
      .openapi({
        description: "footer 주소",
        example: DEFAULT_SITE_SETTINGS.footerAddress,
      }),
    donateBankName: z
      .string()
      .trim()
      .min(1, "은행명은 비워둘 수 없습니다.")
      .openapi({
        description: "/donate 페이지 후원 계좌 은행명",
        example: DEFAULT_SITE_SETTINGS.donateBankName,
      }),
    donateAccountNumber: z
      .string()
      .trim()
      .min(1, "계좌번호는 비워둘 수 없습니다.")
      .openapi({
        description: "/donate 페이지 후원 계좌번호",
        example: DEFAULT_SITE_SETTINGS.donateAccountNumber,
      }),
    donateAccountHolder: z
      .string()
      .trim()
      .min(1, "예금주는 비워둘 수 없습니다.")
      .openapi({
        description: "/donate 페이지 후원 계좌 예금주",
        example: DEFAULT_SITE_SETTINGS.donateAccountHolder,
      }),
  })
  .openapi("ApiSiteSettings");

export const ApiUpdateSiteSettingsSchema = ApiSiteSettingsSchema.partial()
  .extend({
    footerOpenChatUrl: httpUrlInputField(
      "footer 오픈 카톡방 링크",
      DEFAULT_SITE_SETTINGS.footerOpenChatUrl,
    ).optional(),
  })
  .openapi("ApiUpdateSiteSettingsInput");
