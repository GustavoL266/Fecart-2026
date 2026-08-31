import { z } from "zod";

const text = (max) => z.string().trim().max(max);
const strongPassword = z
  .string()
  .min(8, "Use pelo menos 8 caracteres, incluindo letras e números.")
  .max(72, "A senha deve ter no máximo 72 caracteres.")
  .regex(/[A-Za-zÀ-ÖØ-öø-ÿ]/, "Use pelo menos 8 caracteres, incluindo letras e números.")
  .regex(/\d/, "Use pelo menos 8 caracteres, incluindo letras e números.");

export const registerSchema = z
  .object({
    name: text(120).min(2, "Preencha seu nome completo."),
    email: text(320).email("Informe um e-mail válido.").transform((value) => value.toLowerCase()),
    password: strongPassword,
    passwordConfirmation: z.string().max(72),
  })
  .superRefine(({ password, passwordConfirmation }, context) => {
    if (password !== passwordConfirmation) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["passwordConfirmation"], message: "As senhas não coincidem." });
    }
  });

export const loginSchema = z.object({
  email: text(320).email("Informe um e-mail válido.").transform((value) => value.toLowerCase()),
  password: z.string().min(1, "Informe sua senha.").max(72, "Senha inválida."),
});

const monetaryValue = z.coerce.number().finite().min(0).max(10_000_000);

export const productSchema = z.object({
  name: text(160).min(1, "Informe o nome do produto."),
  description: text(2_000).optional().default(""),
  category: text(100).min(1, "Informe a categoria."),
  costPrice: monetaryValue,
  additionalCosts: monetaryValue,
  profitMargin: z.coerce.number().finite().min(0).max(100),
  suggestedPrice: monetaryValue,
  marketplace: text(120).min(1).optional().default("Manual"),
  consultationDate: z.coerce.date().transform((value) => value.toISOString()).optional(),
  calculationData: z.record(z.unknown()).optional().default({}),
});

export const productIdSchema = z.object({
  id: z.string().uuid("Identificador de produto inválido."),
});

export const productListSchema = z.object({
  search: text(160).optional().default(""),
  sort: z.enum(["asc", "desc"]).optional().default("desc"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
});

export function validate(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const message = result.error.issues[0]?.message || "Dados inválidos.";
  const error = new Error(message);
  error.status = 400;
  error.code = "VALIDATION_ERROR";
  throw error;
}
