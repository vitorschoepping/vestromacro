/* conta.js — area do cliente no site: botao Entrar, aba lateral de quem entrou e compra fora do Brasil;
   paginas de entrar, criar conta, confirmar o e-mail e criar senha nova (links do e-mail);
   compra pelo Mercado Pago (pagina comprar: escolher o plano, pagar e a volta do pagamento, com a chave).

   O unico script do site (CSP script-src 'self'). Chama a API do Worker no mesmo endereco,
   /vestromacro/api/conta (server/cloudflare/src/conta.js); a sessao fica num cookie HttpOnly que
   o script nem enxerga. Tudo o que vem da API entra na pagina como texto (textContent), nunca como HTML. */
(() => {
  "use strict";

  const API = "/vestromacro/api/conta";
  const SITE = "/vestromacro/";
  const LARGA = "(min-width: 1000px)";            // a mesma do styles.css: tela larga encolhe o site
  const AVISO = "vestro_conta_aviso";             // mensagem que passa de uma pagina para a outra (sessionStorage)
  const RECOLHIDA = "vestro_aba_recolhida";
  const ANONIMO = "vestro_conta_anonimo";         // quem nao entrou: guarda o "pode comprar" por 5 min,
  const ANONIMO_MS = 5 * 60 * 1000;               // para cada pagina aberta nao gastar um pedido do Worker
  const VOLTAR = "vestro_conta_voltar";           // pagina para voltar depois de entrar (ex.: a compra que pediu login)
  const NOME_PLANO = { monthly: "/mês", annual: "/ano" };
  let pagamentoLigado = false;                    // a API disse que a compra pelo site esta ligada (Mercado Pago)

  const TIPO = { fixed: "Fixa · 1 computador", floating: "Flutuante" };
  const PLANO = { monthly: "Mensal", annual: "Anual", lifetime: "Vitalícia" };

  // ------------------------------------------------------------ ajudantes
  /** Cria um elemento. props: atributos (class, type...) e on* (eventos); filhos: texto ou elementos. */
  function el(tag, props = {}, ...filhos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : String(v));
    }
    for (const f of filhos.flat()) {
      if (f === null || f === undefined || f === false) continue;
      e.append(f instanceof Node ? f : document.createTextNode(String(f)));
    }
    return e;
  }

  function guardar(chave, valor) {
    try {
      if (valor === null) sessionStorage.removeItem(chave);
      else sessionStorage.setItem(chave, valor);
    } catch (e) { /* navegador sem sessionStorage: so perde a lembranca */ }
  }

  function lembrar(chave) {
    try { return sessionStorage.getItem(chave); } catch (e) { return null; }
  }

  /** dd/mm/aaaa no horario de Brasilia (sem horario de verao desde 2019) */
  function dataBr(ts) {
    const d = new Date((Number(ts) - 3 * 3600) * 1000);
    const dois = (n) => String(n).padStart(2, "0");
    return `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }

  async function estado({ usarGuardado = false } = {}) {
    if (usarGuardado) {
      try {
        const g = JSON.parse(lembrar(ANONIMO) || "null");
        if (g && Date.now() - g.em < ANONIMO_MS) return { ok: true, compra: g.compra, pagamento: g.pagamento, precos: g.precos, conta: null };
      } catch (e) { /* guardado estragado: pergunta de novo */ }
    }
    const r = await fetch(API, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("estado " + r.status);
    const e = await r.json();
    guardar(ANONIMO, e.conta ? null : JSON.stringify({ em: Date.now(), compra: e.compra, pagamento: e.pagamento, precos: e.precos }));
    return e;
  }

  /** POST em JSON. Devolve sempre {ok, mensagem?}, mesmo sem internet. */
  async function enviar(acao, dados) {
    try {
      const r = await fetch(API + acao, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(dados),
      });
      const j = await r.json().catch(() => ({}));
      if (j && typeof j.ok === "boolean") return j;
      return { ok: false, mensagem: "Algo deu errado. Tente de novo daqui a pouco." };
    } catch (e) {
      return { ok: false, mensagem: "Sem conexão com o servidor. Confira a internet e tente de novo." };
    }
  }

  const dadosDe = (form) => Object.fromEntries(new FormData(form).entries());

  function mensagem(caixa, texto, tipo) {
    caixa.textContent = texto || "";              // vazia, o styles.css esconde (.conta-msg:empty)
    caixa.className = `conta-msg ${tipo}`;
    caixa.setAttribute("role", tipo === "erro" ? "alert" : "status");
  }

  /** Liga um formulario a uma acao da API. extra: campos que nao estao no formulario (ex.: o link).
   *  depois(resposta) roda quando deu certo. */
  function ligar(form, acao, { conferir, depois, extra }) {
    const caixa = form.querySelector(".conta-msg") || form.insertBefore(el("p", { class: "conta-msg erro" }), form.firstChild);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const dados = dadosDe(form);
      const problema = conferir ? conferir(dados) : "";
      if (problema) return mensagem(caixa, problema, "erro");
      delete dados.senha2;              // a repeticao da senha so e conferida aqui
      delete dados.nova2;
      Object.assign(dados, extra || {});
      const botao = form.querySelector("button[type=submit]");
      if (botao) botao.disabled = true;
      mensagem(caixa, "", "erro");
      const r = await enviar(acao, dados);
      if (botao) botao.disabled = false;
      if (!r.ok) return mensagem(caixa, r.mensagem || "Não deu certo. Tente de novo.", "erro");
      await depois(r, form);
    });
  }

  // ------------------------------------------------------------ paginas de entrar, criar conta e dos links do e-mail
  /** Entrou (ou criou a conta pelo link): volta ao site com a aba aberta e o aviso. */
  function voltarAoSite(aviso) {
    guardar(AVISO, aviso || "");
    guardar(RECOLHIDA, null);
    guardar(ANONIMO, null);
    location.assign(destino());
  }

  /** Para onde ir depois de entrar: a pagina que pediu o login (so do proprio site), ou o inicio. */
  function destino() {
    const v = lembrar(VOLTAR);
    guardar(VOLTAR, null);
    return v && v.startsWith(SITE) && !v.startsWith("//") ? v : SITE;
  }

  /** Troca o formulario por um aviso de "mandamos o e-mail". */
  function mostrarEnviado(form, titulo, ...linhas) {
    form.hidden = true;
    const caixa = el("div", { class: "conta-enviado", role: "status" }, el("h2", {}, titulo), linhas.map((l) => el("p", {}, l)));
    form.after(caixa);
  }

  function paginaDeEntrada(form, acao) {
    const aviso = lembrar(AVISO);           // ex.: veio do link de troca de e-mail sem ter entrado neste navegador
    if (aviso && acao === "/entrar") mensagem(form.querySelector(".conta-msg"), aviso, "ok");
    ligar(form, acao, {
      conferir: (d) => (d.senha2 !== undefined && d.senha !== d.senha2 ? "As duas senhas não são iguais." : ""),
      depois: (r) => {
        if (acao === "/entrar") return voltarAoSite("");
        mostrarEnviado(form, "Confira seu e-mail",
          `Mandamos um link para ${r.email}. Abra o e-mail e clique em “Confirmar e-mail” para criar a conta.`,
          "O link vale por 48 horas. Não chegou? Confira a caixa de spam ou tente de novo daqui a alguns minutos.");
      },
    });
    // ja entrou? volta para o site
    estado().then((e) => { if (e.conta) location.replace(destino()); }).catch(() => {});
  }

  function paginaEsqueci(form) {
    ligar(form, "/esqueci", {
      depois: (r) => mostrarEnviado(form, "Confira seu e-mail",
        `Se ${r.email} tiver conta no site, mandamos para ele um link para criar uma senha nova.`,
        "O link vale por 1 hora. Não chegou? Confira a caixa de spam ou tente de novo daqui a alguns minutos."),
    });
  }

  /** O link do e-mail vem depois do # (#t=...): nao vai ao servidor do site nem fica no historico. */
  function linkDoEmail() {
    // link novo colado na mesma aba (so o # muda, a pagina nao recarrega): comeca de novo com ele
    window.addEventListener("hashchange", () => location.reload());
    const m = /[#&]t=([A-Za-z0-9_-]{43})/.exec(location.hash);
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    return m ? m[1] : "";
  }

  /** Confirmar o e-mail pede um clique: programa que abre os links do e-mail para conferir nao gasta o link. */
  function paginaConfirmar(form, token) {
    if (!token) return semLink(form);
    ligar(form, "/confirmar", {
      extra: { token },
      depois: (r) => {
        if (r.tipo !== "email") return voltarAoSite("E-mail confirmado e conta criada. Aqui ficam suas licenças e seus dados.");
        // troca de e-mail: a pagina de entrar mostra o aviso (e, se ja entrou neste navegador, leva a aba)
        guardar(AVISO, `E-mail trocado. Agora você entra com ${r.email}.`);
        location.assign("login");
      },
    });
  }

  function paginaRedefinir(form, token) {
    if (!token) return semLink(form);
    ligar(form, "/redefinir", {
      extra: { token },
      conferir: (d) => (d.nova !== d.nova2 ? "As duas senhas não são iguais." : ""),
      depois: () => voltarAoSite("Senha nova salva. Os outros navegadores saíram da conta."),
    });
  }

  function semLink(form) {
    mensagem(form.querySelector(".conta-msg"), "Esse link está incompleto. Abra de novo o link do e-mail, ou peça um novo.", "erro");
    for (const c of form.querySelectorAll("input, button")) c.disabled = true;
  }

  // ------------------------------------------------------------ compra fora do Brasil
  /** Os botoes ficam apagados e o .aviso-regiao aparece sozinho (styles.css, :has). */
  function compraIndisponivel() {
    for (const a of document.querySelectorAll("a.comprar")) {
      for (const at of ["href", "target", "rel"]) a.removeAttribute(at);
      a.setAttribute("aria-disabled", "true");
      a.setAttribute("tabindex", "-1");
      a.textContent = "Temporariamente indisponível";
    }
  }

  // ------------------------------------------------------------ compra pelo site (Mercado Pago)
  const reais = (centavos) => (Number(centavos) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  /** Os botoes de plano levam a pagina comprar (no lugar do WhatsApp), e o "Como comprar" troca de lista. */
  function compraPeloSite() {
    for (const a of document.querySelectorAll("a.comprar[data-tipo]")) {
      a.setAttribute("href", `comprar?${new URLSearchParams({ tipo: a.dataset.tipo, plano: a.dataset.plano })}`);
      a.removeAttribute("target");
      a.removeAttribute("rel");
    }
    for (const c of document.querySelectorAll(".como-whats")) c.hidden = true;
    for (const c of document.querySelectorAll(".como-site")) c.hidden = false;
  }

  /** Copia o texto; sem permissao, deixa a chave a mostra para copiar a mao. */
  async function copiar(texto, botao) {
    try {
      await navigator.clipboard.writeText(texto);
      botao.textContent = "Copiada";
    } catch (e) {
      botao.textContent = "Selecione e copie";
    }
  }

  /** Endereco do pagamento: so do Mercado Pago (o servidor manda, mas o script confere antes de ir). */
  function doMercadoPago(endereco) {
    try {
      const u = new URL(endereco);
      return u.protocol === "https:" && /(^|\.)mercadopago\.com(\.br)?$/.test(u.hostname);
    } catch (e) {
      return false;
    }
  }

  function paginaComprar(form) {
    const q = new URLSearchParams(location.search);
    const bloco = (id) => document.getElementById(id);
    // a volta do Mercado Pago traz external_reference (a compra) e payment_id; o resto da URL sai
    const compraId = (q.get("external_reference") || q.get("compra") || "").slice(0, 40);
    const pagamento = (q.get("payment_id") || q.get("collection_id") || q.get("pagamento") || "").replace(/\D/g, "").slice(0, 20);
    if (compraId) {
      const limpa = new URLSearchParams({ compra: compraId });
      if (pagamento) limpa.set("pagamento", pagamento);
      history.replaceState(null, "", `${location.pathname}?${limpa}`);
    }
    estado().then((e) => {
      if (!e.conta) {
        guardar(VOLTAR, location.pathname + location.search);
        bloco("compra-entrar").hidden = false;
        return;
      }
      // no topo, o "Entrar" vira o nome de quem entrou (leva para a conta, no inicio do site)
      const entrar = document.querySelector("a.conta-entrar");
      if (entrar) {
        entrar.textContent = String(e.conta.nome || "").trim().split(/\s+/)[0] || "Minha conta";
        entrar.setAttribute("href", SITE);
      }
      if (compraId) return voltaDoPagamento(compraId, pagamento);
      if (!e.pagamento) {
        if (!e.compra) {
          bloco("compra-off-titulo").textContent = "Compra temporariamente indisponível fora do Brasil";
          bloco("compra-off-texto").textContent = "Você já pode baixar e usar grátis por 30 dias, com tudo liberado.";
        }
        bloco("compra-off").hidden = false;
        return;
      }
      escolherPlano(form, e, q);
    }).catch(() => { bloco("compra-off").hidden = false; });
  }

  function escolherPlano(form, e, q) {
    const caixa = form.querySelector(".conta-msg");
    const botao = form.querySelector("button[type=submit]");
    const vagas = form.querySelector("input[name=vagas]");
    const marcar = (nome, valor) => {
      const r = form.querySelector(`input[name=${nome}][value="${valor}"]`);
      if (r) r.checked = true;
    };
    form.hidden = false;
    let renovar = null;
    const licId = q.get("licenca");
    if (licId) {
      renovar = e.conta.licencas.find((l) => l.id === licId && l.pode_renovar) || null;
      document.getElementById("compra-titulo").textContent = "Renovar licença";
      if (!renovar) {
        mensagem(caixa, "Essa licença não pode ser renovada pelo site. Fale com o suporte via WhatsApp.", "erro");
        botao.disabled = true;
        return;
      }
      const vence = renovar.situacao === "vencida" ? `venceu em ${dataBr(renovar.vence)}` : `vale até ${dataBr(renovar.vence)}`;
      document.getElementById("compra-sub").textContent =
        `Chave terminada em ${renovar.final}, ${vence}. O período novo começa no vencimento (ou hoje, se já venceu); a chave continua a mesma.`;
      marcar("tipo", renovar.tipo);
      marcar("plano", renovar.plano === "annual" ? "annual" : "monthly");
      document.getElementById("compra-tipo").disabled = true;
      vagas.value = String(renovar.vagas);
      vagas.disabled = true;
    } else {
      marcar("tipo", q.get("tipo"));
      marcar("plano", q.get("plano"));
    }
    const escolhido = (nome) => (form.querySelector(`input[name=${nome}]:checked`) || {}).value;
    const nVagas = () => (escolhido("tipo") === "floating" ? Number(vagas.value) : 1);
    function atualizar() {
      const tipo = escolhido("tipo");
      document.getElementById("compra-vagas").hidden = tipo !== "floating";
      const n = nVagas();
      const ok = Number.isInteger(n) && n >= 1 && n <= 50;
      for (const p of form.querySelectorAll(".compra-preco")) {
        const v = e.precos[tipo][p.dataset.plano];
        p.textContent = `${reais(v)}${NOME_PLANO[p.dataset.plano]}${tipo === "floating" ? " por vaga" : ""}`;
      }
      document.getElementById("compra-total").textContent = ok ? reais(e.precos[tipo][escolhido("plano")] * n) : "—";
    }
    form.addEventListener("input", atualizar);
    atualizar();
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const n = nVagas();
      if (!Number.isInteger(n) || n < 1 || n > 50) return mensagem(caixa, "Escolha de 1 a 50 vagas. Mais que isso: fale com a gente pelo WhatsApp.", "erro");
      botao.disabled = true;
      mensagem(caixa, "", "erro");
      const r = await enviar("/comprar", { tipo: escolhido("tipo"), plano: escolhido("plano"), vagas: String(n), licenca: renovar ? renovar.id : "" });
      if (r.ok && doMercadoPago(r.url)) return location.assign(r.url);
      botao.disabled = false;
      mensagem(caixa, r.ok ? "Algo deu errado. Tente de novo daqui a pouco." : (r.mensagem || "Não deu certo. Tente de novo."), "erro");
    });
  }

  /** Volta do Mercado Pago: o servidor confere o pagamento (com o Mercado Pago) e mostra a chave. */
  function voltaDoPagamento(compraId, pagamento) {
    const caixa = document.getElementById("compra-volta");
    const titulo = document.getElementById("compra-titulo");
    const sub = document.getElementById("compra-sub");
    caixa.hidden = false;
    titulo.textContent = "Conferindo o pagamento…";
    sub.textContent = "";
    let tentativas = 0;
    const mostrar = (h, ...partes) => caixa.replaceChildren(el("h2", {}, h), ...partes);
    const irParaConta = () => el("p", { class: "compra-acoes" }, el("a", { class: "btn btn-primary", href: SITE }, "Ir para minha conta"));
    async function conferir() {
      const r = await enviar("/compra", { compra: compraId, pagamento });
      if (!r.ok) {
        titulo.textContent = "Não deu para conferir agora";
        return mostrar("Tente de novo daqui a pouco", el("p", {}, r.mensagem || ""),
          el("p", { class: "compra-acoes" }, el("button", { class: "btn btn-ghost", type: "button", onclick: conferir }, "Conferir de novo")));
      }
      if (r.situacao === "aprovada" && r.renovacao) {
        titulo.textContent = "Licença renovada";
        return mostrar("Pagamento aprovado",
          el("p", {}, `A licença com a chave terminada em ${r.final} agora vale até ${dataBr(r.vence)}. A chave continua a mesma: não precisa fazer nada no Vestro Macro.`),
          el("p", {}, "Mandamos a confirmação para o seu e-mail."), irParaConta());
      }
      if (r.situacao === "aprovada") {
        titulo.textContent = "Pagamento aprovado";
        const copiarBotao = el("button", { class: "btn btn-ghost", type: "button", onclick: () => copiar(r.chave, copiarBotao) }, "Copiar");
        return mostrar("Sua chave",
          r.chave ? el("div", { class: "compra-chave" }, el("code", {}, r.chave), copiarBotao) : null,
          el("p", {}, "No Vestro Macro, digite essa chave onde ele pede a licença."),
          el("p", {}, `Também mandamos a chave para o seu e-mail. Ela fica na sua conta, para copiar quando precisar${r.vence ? `, e vale até ${dataBr(r.vence)}` : ""}.`),
          irParaConta());
      }
      if (r.situacao === "pendente") {
        titulo.textContent = "Pagamento em análise";
        const fim = ++tentativas >= 24;
        if (!fim) setTimeout(conferir, 5000);
        return mostrar("Aguardando o Mercado Pago",
          el("p", {}, "Assim que o pagamento for aprovado, a chave aparece aqui, na sua conta e no seu e-mail. Pix costuma levar alguns segundos."),
          fim ? el("p", {}, "Pode fechar esta página: quando aprovar, mandamos a chave por e-mail.") : null);
      }
      if (r.situacao === "recusada") {
        titulo.textContent = "Pagamento não aprovado";
        return mostrar("O Mercado Pago não aprovou o pagamento",
          el("p", {}, "Tente de novo, se quiser com outra forma de pagamento."),
          el("p", { class: "compra-acoes" }, el("a", { class: "btn btn-primary", href: "comprar" }, "Tentar de novo")));
      }
      if (r.situacao === "devolvida") {
        titulo.textContent = "Pagamento devolvido";
        return mostrar("Esse pagamento foi devolvido", el("p", {}, r.renovacao
          ? "O período dessa renovação saiu da licença. Dúvidas: suporte via WhatsApp."
          : "A licença dessa compra foi bloqueada. Dúvidas: suporte via WhatsApp."), irParaConta());
      }
      titulo.textContent = "Recebemos o pagamento";
      return mostrar("Precisamos conferir uma coisa",
        el("p", {}, "O valor pago não bateu com o pedido, então a chave não saiu sozinha. Fale com o suporte via WhatsApp (47) 98876-9948: resolvemos rápido."));
    }
    conferir();
  }

  // ------------------------------------------------------------ aba lateral
  let campos = 0;
  /** Campo como nas paginas de entrar: div.campo com o rotulo ligado ao input pelo id. */
  function campo(rotulo, attrs, dica) {
    const id = `aba-campo-${++campos}`;
    return el("div", { class: "campo" }, el("label", { for: id }, rotulo), el("input", { ...attrs, id }), dica ? el("small", {}, dica) : null);
  }

  function licencaItem(l) {
    const acoes = el("div", { class: "aba-lic-acoes" });
    const mostra = el("p");
    if (l.tem_chave) {
      const botao = el("button", { type: "button", onclick: async () => {
        botao.disabled = true;
        const r = await enviar("/chave", { licenca: l.id });
        botao.disabled = false;
        if (!r.ok) {
          mostra.className = "conta-msg erro";
          mostra.textContent = r.mensagem || "Não deu certo. Tente de novo.";
        } else {
          mostra.className = "aba-chave-inteira";
          mostra.textContent = r.chave;               // a mostra tambem, se o navegador nao deixar copiar
          await copiar(r.chave, botao);
        }
        acoes.before(mostra);
      } }, "Copiar a chave");
      acoes.append(botao);
    }
    if (pagamentoLigado && l.pode_renovar) acoes.append(el("a", { class: "btn", href: `${SITE}comprar?${new URLSearchParams({ licenca: l.id })}` }, "Renovar"));
    let situacao, aviso = false;
    if (l.situacao === "bloqueada") { situacao = "Bloqueada"; aviso = true; }
    else if (l.situacao === "vencida") { situacao = `Vencida em ${dataBr(l.vence)}`; aviso = true; }
    else situacao = l.vence === null ? "Ativa, sem vencimento" : `Ativa até ${dataBr(l.vence)}`;
    const tipo = l.tipo === "floating" ? `Flutuante · ${l.vagas} ${l.vagas === 1 ? "vaga" : "vagas"}` : TIPO.fixed;
    const onde = l.tipo === "floating"
      ? `${l.em_uso} de ${l.vagas} em uso agora`
      : (l.computador ? `No computador ${l.computador}` : "Ainda não ativada em nenhum computador");
    const item = el("li", { class: "aba-lic" },
      el("div", { class: "aba-lic-topo" }, el("h3", {}, tipo), el("span", { class: aviso ? "aba-status aviso" : "aba-status" }, situacao)),
      el("p", { class: "aba-chave" }, `${PLANO[l.plano] || l.plano} · chave terminada em ${l.final}`),
      el("p", {}, onde),
      acoes.childElementCount ? acoes : null);
    return item;
  }

  function abrirAba(aberta) {
    document.body.classList.toggle("aba-aberta", aberta);
    const botao = document.querySelector(".conta-botao");
    if (botao) botao.setAttribute("aria-expanded", String(aberta));
    const aba = document.getElementById("minha-conta");
    if (aba) aba.inert = !aberta;
    if (window.matchMedia(LARGA).matches) guardar(RECOLHIDA, aberta ? null : "1");
  }

  /** Monta (ou monta de novo, depois de salvar) a aba de quem entrou. */
  function montarAba(conta, aviso) {
    const recarregar = (texto) => async () => {
      try {
        const e = await estado();
        if (e.conta) montarAba(e.conta, texto);
        else location.assign(SITE);
      } catch (err) { /* sem internet: a aba fica como esta */ }
    };

    const lista = conta.licencas.length
      ? el("ul", { class: "aba-lista" }, conta.licencas.map(licencaItem))
      : el("p", { class: "aba-vazio" }, "Nenhuma licença na sua conta ainda. Comprou pelo WhatsApp? Adicione a chave aqui embaixo.");

    const fLicenca = el("form", { class: "aba-form", method: "post", novalidate: true },
      campo("Chave", { name: "chave", required: true, maxlength: 64, placeholder: "VSTR-XXXXX-XXXXX-XXXXX-XXXXX", autocomplete: "off", spellcheck: "false" }),
      el("button", { type: "submit" }, "Adicionar"));
    ligar(fLicenca, "/licenca", { depois: recarregar("Licença adicionada à sua conta.") });

    const fDados = el("form", { class: "aba-form", method: "post", novalidate: true },
      campo("Nome", { name: "nome", required: true, maxlength: 80, autocomplete: "name", value: conta.nome }),
      campo("E-mail", { type: "email", name: "email", required: true, maxlength: 254, autocomplete: "email", value: conta.email }),
      campo("Telefone de contato", { type: "tel", name: "telefone", maxlength: 30, autocomplete: "tel", value: conta.telefone, placeholder: "(47) 99999-9999" }),
      campo("Senha atual", { type: "password", name: "senha", maxlength: 200, autocomplete: "current-password" }, "só para trocar o e-mail"),
      el("button", { class: "aba-principal", type: "submit" }, "Salvar"));
    ligar(fDados, "/dados", { depois: (r) => recarregar(r.email_pendente
      ? `Dados salvos. Mandamos um link para ${r.email_pendente}: o e-mail da conta muda quando você abrir esse link.`
      : "Dados salvos.")() });

    const fSenha = el("form", { class: "aba-form", method: "post", novalidate: true },
      campo("Senha atual", { type: "password", name: "senha", required: true, maxlength: 200, autocomplete: "current-password" }),
      campo("Senha nova", { type: "password", name: "nova", required: true, minlength: 8, maxlength: 200, autocomplete: "new-password" }),
      campo("Repita a senha nova", { type: "password", name: "nova2", required: true, minlength: 8, maxlength: 200, autocomplete: "new-password" }),
      el("button", { type: "submit" }, "Trocar a senha"));
    ligar(fSenha, "/senha", {
      conferir: (d) => (d.nova !== d.nova2 ? "As duas senhas novas não são iguais." : ""),
      depois: recarregar("Senha trocada. Os outros navegadores saíram da conta."),
    });

    const sair = el("button", { class: "aba-sair", type: "button", onclick: async () => {
      await enviar("/sair", {});
      guardar(RECOLHIDA, null);
      guardar(ANONIMO, null);
      location.assign(SITE);
    } }, "Sair da conta");

    const msg = el("p", { class: "conta-msg ok" });
    if (aviso) mensagem(msg, aviso, "ok");

    const iniciais = String(conta.nome || "").trim().split(/\s+/).slice(0, 2).map((p) => p[0] || "").join("").toUpperCase();
    const aba = el("aside", { class: "aba-conta", id: "minha-conta", "aria-label": "Minha conta" },
      el("div", { class: "aba-topo" },
        el("span", {}, "Minha conta"),
        el("button", { class: "aba-fechar", type: "button", title: "Recolher a aba", "aria-label": "Recolher a aba",
          onclick: () => abrirAba(false) }, "×")),
      el("div", { class: "aba-perfil" },
        el("span", { class: "aba-avatar", "aria-hidden": "true" }, iniciais || "?"),
        el("div", {}, el("strong", {}, conta.nome), el("small", {}, conta.email))),
      msg,
      el("h2", {}, "Licenças"), lista,
      el("details", { class: "aba-mais" }, el("summary", {}, "Adicionar uma licença pela chave"), fLicenca),
      el("h2", {}, "Meus dados"), fDados,
      el("details", { class: "aba-mais" }, el("summary", {}, "Trocar a senha"), fSenha),
      sair);

    const antiga = document.getElementById("minha-conta");
    if (antiga) antiga.replaceWith(aba);
    else document.body.prepend(aba);

    // topo: "Entrar" vira o nome de quem entrou, e abre/fecha a aba
    const primeiro = String(conta.nome || "").trim().split(/\s+/)[0] || "Minha conta";
    const botao = el("button", { class: "conta-botao", type: "button", "aria-controls": "minha-conta",
      onclick: () => abrirAba(!document.body.classList.contains("aba-aberta")) }, el("span", {}, primeiro));
    const atual = document.querySelector("a.conta-entrar, button.conta-botao");
    if (atual) atual.replaceWith(botao);

    document.body.classList.add("com-conta");
    const aberta = Boolean(aviso) || document.body.classList.contains("aba-aberta") ||
      (window.matchMedia(LARGA).matches && !lembrar(RECOLHIDA));
    abrirAba(aberta);
  }

  // ------------------------------------------------------------ inicio
  function iniciar() {
    const form = (id) => document.getElementById(id);
    if (form("form-entrar")) return paginaDeEntrada(form("form-entrar"), "/entrar");
    if (form("form-criar")) return paginaDeEntrada(form("form-criar"), "/criar");
    if (form("form-esqueci")) return paginaEsqueci(form("form-esqueci"));
    if (form("form-confirmar")) return paginaConfirmar(form("form-confirmar"), linkDoEmail());
    if (form("form-redefinir")) return paginaRedefinir(form("form-redefinir"), linkDoEmail());
    if (form("form-comprar")) return paginaComprar(form("form-comprar"));
    estado({ usarGuardado: true }).then((e) => {
      if (!e.compra) compraIndisponivel();
      pagamentoLigado = Boolean(e.pagamento);
      if (pagamentoLigado) compraPeloSite();
      if (e.conta) {
        const aviso = lembrar(AVISO);
        guardar(AVISO, null);
        montarAba(e.conta, aviso);
      }
    }).catch(() => { /* API fora do ar: o site continua como esta, com o Entrar */ });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && document.body.classList.contains("aba-aberta") && !window.matchMedia(LARGA).matches) abrirAba(false);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
