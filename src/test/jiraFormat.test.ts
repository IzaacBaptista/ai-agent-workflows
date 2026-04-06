import test from "node:test";
import assert from "node:assert/strict";
import { formatJiraIssue } from "../integrations/jira/formatJiraIssue";

test("formatJiraIssue strips Jira boilerplate and truncates oversized descriptions", () => {
  const formatted = formatJiraIssue({
    key: "REL-5391",
    url: "https://example.atlassian.net/browse/REL-5391",
    summary: "Cadastro de cor ignorando configuração de integração",
    issueType: "Bug",
    status: "To Do",
    priority: "Baixa",
    assignee: "Izaac Baptista",
    labels: [],
    components: [],
    description: [
      "-------Informações do Movidesk-------",
      "Ticket: 7097.",
      "Aberto por: Leonardo.",
      "Solicitante(s): Cliente XPTO.",
      "",
      "Título: cadastro duplicado",
      "Tenant: luxico.multiplier - Integrado",
      "Origem: Onboarding - Vitor",
      "",
      "Descrição detalhada:",
      "Permitindo cadastrar cor mesmo que a configuração esteja marcada apenas como receber.",
      "",
      "Passos para Reproduzir o Problema: Menu lateral > Produtos > Cores > '+'",
      "",
      "Impacto no Cliente:",
      "Ao cadastrar a cor pelo Multiplier, a mesma não irá existir no ERP.",
      "",
      ...Array.from({ length: 30 }, (_, index) => `Linha extra ${index + 1}`),
    ].join("\n"),
  });

  assert.match(formatted, /Jira Issue: REL-5391/);
  assert.match(formatted, /Tenant: luxico\.multiplier - Integrado/);
  assert.match(formatted, /Descrição detalhada:/);
  assert.match(formatted, /Impacto no Cliente:/);
  assert.doesNotMatch(formatted, /Informações do Movidesk/i);
  assert.doesNotMatch(formatted, /Aberto por:/i);
  assert.doesNotMatch(formatted, /Solicitante\(s\):/i);
  assert.doesNotMatch(formatted, /Ticket:/i);
  assert.doesNotMatch(formatted, /Título:/i);
  assert.match(formatted, /\[truncated\]/);
});
