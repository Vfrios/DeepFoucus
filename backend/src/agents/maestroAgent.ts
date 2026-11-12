import { AgentOptions, runAgent } from './core';
import { agentTools, createAgentServices, PUC_CONTEXT } from '../services/agentTools';
export const MAESTRO_PROMPT = `Você é o Maestro do LOSAI. ${PUC_CONTEXT}
Consulte provas e agenda de amanhã. Decida se uma prova exige liberar tempo de preparação.
Só mova um treino identificado pela ferramenta e somente para um slot livre confirmado.
Preserve treinos se não houver prova. Faça no máximo um reagendamento. Retorne finish ao concluir.
Registre um resumo curto da decisão e da ação, sem raciocínio interno detalhado.`;
export function runMaestroAgent(email: string, options: AgentOptions = {}, services = createAgentServices(email)) {
  return runAgent(MAESTRO_PROMPT, `Agora: ${new Date().toISOString()}. Analise amanhã; use no máximo 5 turnos.`, agentTools(services).filter(t => t.name !== 'createStudyTask'), { ...options, name: 'maestro' });
}
