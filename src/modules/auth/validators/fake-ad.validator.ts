import { Injectable } from '@nestjs/common';
import { Papel } from '../../../generated/prisma/client.js';
import type {
  CredentialValidator,
  ValidatedIdentity,
} from '../credential-validator.js';

// Fonte de identidade de DESENVOLVIMENTO. Simula o AD com usuários fixos.
// Produção com este validator NÃO SOBE (trava no factory do auth.module).
// Vira fixture permanente dos testes e2e — os testes de RBAC rodam contra ele.
const FAKE_USERS: Record<
  string,
  { password: string; identity: ValidatedIdentity }
> = {
  'dev.gestor': {
    password: 'dev',
    identity: {
      name: 'Gestor de Dev',
      email: 'gestor@dev.local',
      cpf: '00000000191',
      papeis: [Papel.gestor],
    },
  },
  'dev.titulacao': {
    password: 'dev',
    identity: {
      name: 'Titulação de Dev',
      email: null,
      cpf: null,
      papeis: [Papel.titulacao],
    },
  },

  'dev.admin': {
    password: 'dev',
    identity: {
      name: 'Admin de Dev',
      email: null,
      cpf: null,
      papeis: [Papel.administrador],
    },
  },
  // Simula quem existe no AD mas não está em nenhum grupo do sistema:
  // o login deve NEGAR (sem papel, sem acesso).
  'dev.semgrupo': {
    password: 'dev',
    identity: { name: 'Sem Grupo de Dev', email: null, cpf: null, papeis: [] },
  },
};

@Injectable()
export class FakeAdValidator implements CredentialValidator {
  validate(
    username: string,
    password: string,
  ): Promise<ValidatedIdentity | null> {
    const entry = FAKE_USERS[username];
    if (!entry || entry.password !== password) {
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.identity);
  }
}
