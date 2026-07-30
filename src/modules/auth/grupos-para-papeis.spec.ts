import { describe, expect, it } from '@jest/globals';
import { Papel } from '../../generated/prisma/client.js';
import { gruposParaPapeis } from './grupos-para-papeis.js';

const DC = 'OU=Grupos,DC=intranet,DC=iteraima,DC=rr,DC=gov,DC=br';

describe('gruposParaPapeis', () => {
  it('mapeia um grupo válido para o papel correspondente', () => {
    const r = gruposParaPapeis([`CN=TITULA_FINANCEIRO,${DC}`]);
    expect(r.papeis).toEqual([Papel.financeiro]);
    expect(r.desconhecidos).toEqual([]);
  });

  it('mapeia múltiplos grupos válidos', () => {
    const r = gruposParaPapeis([
      `CN=TITULA_GESTOR,${DC}`,
      `CN=TITULA_TITULACAO,${DC}`,
    ]);
    expect(r.papeis).toEqual(
      expect.arrayContaining([Papel.gestor, Papel.titulacao]),
    );
    expect(r.papeis).toHaveLength(2);
  });

  it('ignora em silêncio grupos fora do prefixo', () => {
    const r = gruposParaPapeis([
      `CN=VPN_USERS,${DC}`,
      `CN=Domain Users,${DC}`,
      `CN=TITULA_ATENDIMENTO,${DC}`,
    ]);
    expect(r.papeis).toEqual([Papel.atendimento]);
    expect(r.desconhecidos).toEqual([]);
  });

  it('reporta como desconhecido o sufixo que não é papel (typo da TI)', () => {
    const r = gruposParaPapeis([`CN=TITULA_FINANCEIROO,${DC}`]);
    expect(r.papeis).toEqual([]);
    expect(r.desconhecidos).toEqual(['TITULA_FINANCEIROO']);
  });

  it('ignora DN malformado sem quebrar', () => {
    const r = gruposParaPapeis(['isto-nao-e-um-dn', '']);
    expect(r.papeis).toEqual([]);
    expect(r.desconhecidos).toEqual([]);
  });

  it('devolve vazio para lista vazia', () => {
    const r = gruposParaPapeis([]);
    expect(r.papeis).toEqual([]);
    expect(r.desconhecidos).toEqual([]);
  });

  it('é case-insensitive no CN e no prefixo', () => {
    const r = gruposParaPapeis([`cn=titula_gestor,${DC}`]);
    expect(r.papeis).toEqual([Papel.gestor]);
  });

  it('deduplica papel repetido', () => {
    const r = gruposParaPapeis([
      `CN=TITULA_GESTOR,${DC}`,
      `CN=TITULA_GESTOR,${DC}`,
    ]);
    expect(r.papeis).toEqual([Papel.gestor]);
  });
});
