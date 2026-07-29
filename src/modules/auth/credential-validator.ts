import type { Papel } from '../../generated/prisma/client.js';

// Identidade resolvida pela fonte de credenciais.
// Quem resolve papéis é o VALIDATOR (fake/AD leem grupos; local lê a coluna).
export interface ValidatedIdentity {
  name: string;
  email: string | null;
  cpf: string | null;
  papeis: Papel[];
}

export interface CredentialValidator {
  // null = credencial inválida. Nunca detalhar o motivo ao cliente.
  validate(
    username: string,
    password: string,
  ): Promise<ValidatedIdentity | null>;
}

// Token de injeção da fonte REMOTA de identidade (fake hoje, AD na Fase C).
// A conta LOCAL (break-glass) NÃO passa por aqui — é o LocalValidator, sempre.
export const CREDENTIAL_VALIDATOR = Symbol('CREDENTIAL_VALIDATOR');
