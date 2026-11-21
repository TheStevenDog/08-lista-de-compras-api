import { z } from "zod";

export const resourceIdSchema = z
  .string()
  .trim()
  .min(1, "El identificador es obligatorio")
  .max(128, "El identificador excede el límite de 128 caracteres")
  .regex(/^[A-Za-z0-9_-]+$/, "El identificador contiene caracteres no permitidos");

export const isoDateSchema = z
  .string()
  .trim()
  .refine((val) => !Number.isNaN(Date.parse(val)), {
    message: "Debe ser una fecha ISO 8601 válida",
  });

export const registroSchema = z
  .object({
    email: z.string().trim().email("Correo electrónico inválido").toLowerCase(),
    password: z
      .string()
      .min(8, "La contraseña debe tener al menos 8 caracteres")
      .max(128, "La contraseña no puede superar 128 caracteres"),
  })
  .strip();

export const loginSchema = z
  .object({
    email: z.string().trim().email("Correo electrónico inválido").toLowerCase(),
    password: z
      .string()
      .min(1, "La contraseña es obligatoria")
      .max(128, "La contraseña no puede superar 128 caracteres"),
  })
  .strip();

export const refreshSchema = z
  .object({
    refreshToken: z.string().trim().min(1, "refreshToken es obligatorio"),
  })
  .strip();

export const codigoCompartirSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6}$/, "El código compartido debe tener 6 caracteres alfanuméricos");

export const listaPutSchema = z
  .object({
    nombre: z
      .string()
      .trim()
      .min(1, "El nombre de la lista es obligatorio")
      .max(120, "El nombre de la lista no puede superar 120 caracteres"),
    cerrada: z.boolean().default(false),
    codigo_compartir: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{6}$/, "codigo_compartir debe tener 6 caracteres alfanuméricos")
      .nullable()
      .optional(),
  })
  .strip();

export const itemPutSchema = z
  .object({
    lista_id: resourceIdSchema,
    nombre: z
      .string()
      .trim()
      .min(1, "El nombre del producto es obligatorio")
      .max(120, "El nombre del producto no puede superar 120 caracteres"),
    cantidad: z
      .number({
        required_error: "La cantidad es obligatoria",
        invalid_type_error: "La cantidad debe ser un número entero",
      })
      .int("La cantidad debe ser un número entero")
      .min(1, "La cantidad mínima es 1")
      .max(99, "La cantidad máxima es 99"),
    categoria: z
      .string()
      .trim()
      .min(1, "La categoría no puede estar vacía")
      .max(60, "La categoría no puede superar 60 caracteres")
      .default("otros"),
    comprado: z.boolean().default(false),
  })
  .strip();

export const sharedItemPatchSchema = z
  .object({
    comprado: z.boolean({
      required_error: "El campo comprado es obligatorio",
      invalid_type_error: "El campo comprado debe ser booleano",
    }),
  })
  .strip();
