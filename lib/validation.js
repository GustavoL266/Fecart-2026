import { z } from "zod";

const text = (max) => z.string().trim().max(max);
const strictNumber = z.number().finite();
const strongPassword = z.string().min(8, "Use pelo menos 8 caracteres, incluindo letras e números.").max(72, "A senha deve ter no máximo 72 caracteres.").regex(/[A-Za-zÀ-ÖØ-öø-ÿ]/, "Use pelo menos 8 caracteres, incluindo letras e números.").regex(/\d/, "Use pelo menos 8 caracteres, incluindo letras e números.");

export const registerSchema = z.object({
  name: text(120).min(2, "Preencha seu nome completo."), email: text(320).email("Informe um e-mail válido.").transform((value) => value.toLowerCase()), password: strongPassword, passwordConfirmation: z.string().max(72),
}).superRefine(({ password, passwordConfirmation }, context) => {
  if (password !== passwordConfirmation) context.addIssue({ code: z.ZodIssueCode.custom, path: ["passwordConfirmation"], message: "As senhas não coincidem." });
});
export const loginSchema = z.object({ email: text(320).email("Informe um e-mail válido.").transform((value) => value.toLowerCase()), password: z.string().min(1, "Informe sua senha.").max(72, "Senha inválida.") });

const marketSchema = z.object({
  rule: z.enum(["manual", "selected-product", "amazon-average", "amazon-median"]).optional(),
  query: text(160).optional().default(""),
  marketplace: text(120).optional().default(""),
  provider: text(120).optional().default(""),
  selectedProduct: z.record(z.unknown()).nullable().optional(),
  stats: z.record(z.unknown()).nullable().optional(),
}).optional().default({});

// Derivados como preço, margem, totais ou resultado não fazem parte do contrato.
export const productCreateSchema = z.object({
  name: text(160).min(1, "Informe o nome do produto."),
  description: text(2_000).optional().default(""),
  category: text(100).min(1).optional().default("Não categorizado"),
  pricing: z.object({
    inputs: z.record(z.unknown()),
    market: marketSchema,
    fiscalValidation: z.record(z.unknown()).nullable().optional(),
    emptyOptionalFields: z.array(z.string()).max(20).optional().default([]),
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
export const marketSearchSchema = z.object({ q: text(160).min(3, "Informe um produto para pesquisar.") });

export function validate(schema, input, { code = "VALIDATION_ERROR" } = {}) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const error = new Error(result.error.issues[0]?.message || "Dados inválidos.");
  error.status = 400;
  error.code = code;
  throw error;
}
