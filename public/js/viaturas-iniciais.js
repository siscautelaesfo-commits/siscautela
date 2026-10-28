// Viaturas copiadas do app VTR-ESFO em 27/10/2026, para a importação inicial.
// Placa e ano ainda não estavam cadastrados lá; completar pelo app depois.
// "prioridade" veio do campo "ordem" do VTR-ESFO (1 = primeira a ser usada).
export const VIATURAS_INICIAIS = [
  { prefixo: '17692', modelo: 'Renault/Master', combustivel: 'diesel', kmAtual: 2749, situacao: 'ativa', prioridade: 1, nova: true, temRadio: true, usaArla: false },
  { prefixo: '16843', modelo: 'Ford/Ranger', combustivel: 'diesel', kmAtual: 29670, situacao: 'manutencao', prioridade: 2, nova: false, temRadio: true, usaArla: true },
  { prefixo: '13659', modelo: 'Chevrolet/Trailblazer', combustivel: 'gasolina', kmAtual: 97045, situacao: 'ativa', prioridade: 3, nova: false, temRadio: true, usaArla: false },
  { prefixo: '14058', modelo: 'Chevrolet/Trailblazer', combustivel: 'diesel', kmAtual: 91701, situacao: 'ativa', prioridade: 4, nova: false, temRadio: true, usaArla: false },
  { prefixo: '15603', modelo: 'Renault/Duster', combustivel: 'flex', kmAtual: 37694, situacao: 'ativa', prioridade: 5, nova: false, temRadio: true, usaArla: false },
  { prefixo: '15591', modelo: 'Renault/Duster', combustivel: 'flex', kmAtual: 47820, situacao: 'ativa', prioridade: 6, nova: false, temRadio: true, usaArla: false },
  { prefixo: '18148', modelo: 'Renault/Duster', combustivel: 'flex', kmAtual: 8252, situacao: 'ativa', prioridade: 7, nova: true, temRadio: true, usaArla: false },
  { prefixo: '18158', modelo: 'Renault/Duster', combustivel: 'flex', kmAtual: 7636, situacao: 'baixada', prioridade: 7, nova: true, temRadio: true, usaArla: false },
  { prefixo: '17950', modelo: 'Renault/Duster', combustivel: 'flex', kmAtual: 8024, situacao: 'ativa', prioridade: 8, nova: true, temRadio: true, usaArla: false },
  { prefixo: '18170', modelo: 'Renault/Duster', combustivel: 'flex', kmAtual: 8705, situacao: 'ativa', prioridade: 9, nova: true, temRadio: true, usaArla: false },
  { prefixo: 'C4', modelo: 'Comando EsFO', combustivel: 'flex', kmAtual: 74518, situacao: 'usoExclusivo', prioridade: 10, nova: false, temRadio: false, usaArla: false }
];
