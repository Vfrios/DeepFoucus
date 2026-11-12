import { AgentOptions, runAgent } from './core';
import { agentTools, createAgentServices, PUC_CONTEXT } from '../services/agentTools';
export const TUTOR_PROMPT = `Você é o Tutor do LOSAI. ${PUC_CONTEXT}
Consulte as provas futuras e planeje até dois blocos de estudo de uma hora antes das provas.
Use findFreeSlots antes de criar tarefas. Não crie tarefas sem prova confirmada.
Não mova treinos: essa ação pertence ao Maestro. Use os títulos reais das matérias.
Registre um resumo curto do plano e retorne finish. Limite total: 5 turnos.`;
export function runTutorAgent(email: string, options: AgentOptions = {}, services = createAgentServices(email)) {
  return runAgent(TUTOR_PROMPT, `Agora: ${new Date().toISOString()}. Planeje estudos conservadoramente.`, agentTools(services).filter(t => t.name !== 'moveWorkout'), { ...options, name: 'tutor' });
}
