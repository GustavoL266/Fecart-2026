import { z } from "zod";
import { FISCAL_BRAZIL_STATES } from "../js/domain/fiscal-context.js";

const text = (max) => z.string().trim().max(max);
const strictNumber = z.number().finite();
const strongPassword = z.string().min(8, "Use pelo menos 8 caracteres, incluindo letras e números.").max(72, "A senha deve ter no máximo 72 caracteres.").regex(/[A-Za-zÀ-ÖØ-öø-ÿ]/, "Use pelo menos 8 caracteres, incluindo letras e números.").regex(/\d/, "Use pelo menos 8 caracteres, incluindo letras e números.");
const email = text(320).email("Informe um e-mail válido.").transform((value) => value.toLowerCase());

export const registerSchema = z.object({
  name: text(120).min(2, "Preencha seu nome completo."), email, password: strongPassword, passwordConfirmation: z.string().max(72),
}).superRefine(({ password, passwordConfirmation }, context) => {
  if (password !== passwordConfirmation) context.addIssue({ code: z.ZodIssueCode.custom, path: ["passwordConfirmation"], message: "As senhas não coincidem." });
});
export const loginSchema = z.object({ email, password: z.string().min(1, "Informe sua senha.").max(72, "Senha inválida.") });

export const profileUpdateSchema = z.object({
  name: text(120).min(1, "O nome não pode ficar vazio.").min(2, "Informe um nome com pelo menos 2 caracteres."),
}).strict();

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Informe sua senha atual.").max(72, "Senha atual inválida."),
  newPassword: strongPassword,
  newPasswordConfirmation: z.string().max(72),
}).strict().superRefine(({ newPassword, newPasswordConfirmation }, context) => {
  if (newPassword !== newPasswordConfirmation) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["newPasswordConfirmation"], message: "As senhas não coincidem." });
  }
});

const marketSchema = z.object({
  rule: z.enum(["manual", "selected-product", "market-average", "market-median"]).optional(),
  query: text(160).optional().default(""),
  marketplace: text(120).optional().default(""),
  provider: text(120).optional().default(""),
  selectedProduct: z.record(z.unknown()).nullable().optional(),
  stats: z.record(z.unknown()).nullable().optional(),
}).optional().default({});

// Deve permanecer alinhado aos campos opcionais produzidos por
// validatePricingForm. O enum impede que nomes arbitrários atravessem a API.
export const EMPTY_OPTIONAL_FIELD_IDS = Object.freeze([
  "wasteRate", "packagingCost", "averageOrderFreight", "averageOrderUnits", "companyFreightShare",
  "otherVariableCost", "otherDirectExpenses", "monthlyLaborCost", "monthlyProductiveHours",
  "laborHourlyCost", "productionTimeMinutes", "monthlyFixedCosts", "expectedMonthlyUnits",
  "allocationLaborHours", "machineTimeMinutes",
  "monthlyMachineHours", "monthlyBusinessRevenue", "monthlyProductRevenue", "equipmentValue",
  "equipmentUsefulLifeMonths", "equipmentMaintenanceMonthly", "paymentFeeRate", "commissionRate",
  "marketplaceFeeRate", "fixedFeePerOrder", "postSaleLossRate", "minimumMargin", "taxRate",
  "inventoryDays", "receivingDays", "paymentDays", "monthlyCapitalRate", "discountRate",
  "fixedDiscountAmount", "marketPrice",
]);

const emptyOptionalFieldsSchema = z.array(z.enum(EMPTY_OPTIONAL_FIELD_IDS))
  .max(EMPTY_OPTIONAL_FIELD_IDS.length)
  .refine((fields) => new Set(fields).size === fields.length, "A lista de campos opcionais vazios não pode conter duplicatas.");

// Derivados como preço, margem, totais ou resultado não fazem parte do contrato.
export const productCreateSchema = z.object({
  name: text(160).min(1, "Informe o nome do produto."),
  description: text(2_000).optional().default(""),
  category: text(100).min(1).optional().default("Não categorizado"),
  pricing: z.object({
    inputs: z.record(z.unknown()),
    market: marketSchema,
    fiscalValidation: z.record(z.unknown()).nullable().optional(),
    emptyOptionalFields: emptyOptionalFieldsSchema.optional().default([]),
  }),
});

// Edição rápida é estritamente editorial; não pode romper o snapshot financeiro.
export const productMetadataSchema = z.object({
  name: text(160).min(1, "Informe o nome do produto."),
  description: text(2_000).optional().default(""),
  category: text(100).min(1, "Informe a categoria."),
});

// Mantido como alias para consumidores externos antigos; novas rotas usam os schemas explícitos.
export const productSchema = productCreateSchema;
export const productIdSchema = z.object({ id: z.string().uuid("Identificador de produto inválido.") });
export const productListSchema = z.object({ search: text(160).optional().default(""), sort: z.enum(["asc", "desc"]).optional().default("desc"), limit: strictNumber.int().min(1).max(100).optional().default(100) });
export const marketSearchSchema = z.object({ q: text(160).min(3, "Informe um produto para pesquisar."), refresh: z.enum(["1"]).optional() });
export const ncmSearchSchema = z.object({ q: text(120).min(3, "Informe uma descrição para pesquisar NCM."), originalQuery: text(160).optional() });

export const taxEstimateSchema = z.object({
  ncm: z.string().regex(/^\d{8}$/, "Informe e confirme um NCM com 8 dígitos, sem espaços ou outros caracteres."),
  productOrigin: z.enum(["nacional", "importado"], { required_error: "Selecione a origem do produto." }),
  countryOfOrigin: text(80).optional().default(""),
  originState: z.enum(["", ...FISCAL_BRAZIL_STATES]).optional().default(""),
  destinationState: z.enum(["", ...FISCAL_BRAZIL_STATES]).optional().default(""),
  unitValue: strictNumber.positive("O preço do produto de maior valor deve ser positivo."),
  classificationId: text(80).min(1, "Confirme a classificação fiscal atual."),
  originalQuery: text(160).min(3, "Informe o produto para classificação fiscal."),
  normalizedQuery: text(120).min(3, "Informe a categoria para classificação fiscal."),
});

export function validate(schema, input, { code = "VALIDATION_ERROR" } = {}) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || "Dados inválidos.");
  error.status = 400;
  error.code = code;
  throw error;
}
