// Conteúdo configurável das páginas Fotos e Tabelas. Edite aqui.
export const photos: string[] = [
  // 'https://exemplo.com/foto1.jpg',
];

export interface TableDef {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

export const tables: TableDef[] = [
  {
    title: 'Cardápio da semana',
    columns: ['Dia', 'Almoço', 'Jantar'],
    rows: [
      ['Seg', 'Frango assado', 'Sopa'],
      ['Ter', 'Macarrão', 'Omelete'],
      ['Qua', 'Feijoada leve', 'Salada'],
    ],
  },
];
