/* conta.js — area do cliente no site: botao Entrar, aba lateral de quem entrou e compra fora do Brasil;
   paginas de entrar, criar conta, confirmar o e-mail e criar senha nova (links do e-mail);
   compra pelo Mercado Pago (pagina comprar: escolher o plano e a renovacao, pagar e a volta do pagamento, com a
   chave) e, fora do Brasil, pela Paddle (em dolar, sempre com renovacao automatica); na aba, cancelar a renovacao
   automatica.

   O unico script do site (CSP script-src 'self'). Chama a API do Worker no mesmo endereco,
   /vestromacro/api/conta (server/cloudflare/src/conta.js); a sessao fica num cookie HttpOnly que
   o script nem enxerga. Tudo o que vem da API entra na pagina como texto (textContent), nunca como HTML. */
(() => {
  "use strict";

  const API = "/vestromacro/api/conta";
  // inicio do site no idioma da pagina: /en/vestromacro/ (paginas geradas por tools/site_idiomas.py) ou /vestromacro/
  const DO_SITE = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?vestromacro\//;
  const SITE = (DO_SITE.exec(location.pathname) || ["/vestromacro/"])[0];
  // traducao dos textos deste script: as paginas em outro idioma trazem um <script type="application/json" id="textos">
  // (so dados, a CSP nao roda), com chave = texto em portugues, como no app. Sem ele (portugues), o texto fica como esta.
  const TEXTOS = (() => {
    try { return JSON.parse((document.getElementById("textos") || {}).textContent || "{}"); } catch (e) { return {}; }
  })();
  const IDIOMA = document.documentElement.lang || "pt-BR";
  const LARGA = "(min-width: 1000px)";            // a mesma do styles.css: tela larga encolhe o site
  const AVISO = "vestro_conta_aviso";             // mensagem que passa de uma pagina para a outra (sessionStorage)
  const RECOLHIDA = "vestro_aba_recolhida";
  const ANONIMO = "vestro_conta_anonimo";         // quem nao entrou: guarda o "pode comprar" por 5 min,
  const ANONIMO_MS = 5 * 60 * 1000;               // para cada pagina aberta nao gastar um pedido do Worker
  const VOLTAR = "vestro_conta_voltar";           // pagina para voltar depois de entrar (ex.: a compra que pediu login)
  const PADDLE = "vestro_paddle_assinatura";      // id da assinatura que foi para o checkout da Paddle (a volta nao traz)
  const NOME_PLANO = { monthly: t("/mês"), annual: t("/ano") };
  let pagamentoLigado = false;                    // a API disse que a compra pelo site esta ligada (Mercado Pago)

  const TIPO = { fixed: t("Fixa · 1 computador"), floating: t("Flutuante") };
  const PLANO = { monthly: t("Mensal"), annual: t("Anual"), lifetime: t("Vitalícia") };

  // ------------------------------------------------------------ ajudantes
  /** Texto no idioma da pagina; {nome} troca pelo valor. tools/site_idiomas.py acha as chaves pelas chamadas de t. */
  function t(texto, valores = {}) {
    return (TEXTOS[texto] || texto).replace(/\{(\w+)\}/g, (m, k) => (k in valores ? String(valores[k]) : m));
  }

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

  /** dd/mm/aaaa no horario de Brasilia (sem horario de verao desde 2019); nos outros idiomas, a data como o idioma escreve */
  function dataBr(ts) {
    const d = new Date((Number(ts) - 3 * 3600) * 1000);
    if (!IDIOMA.startsWith("pt")) {
      try { return d.toLocaleDateString(IDIOMA, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }); } catch (e) { /* abaixo */ }
    }
    const dois = (n) => String(n).padStart(2, "0");
    return `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }

  async function estado({ usarGuardado = false } = {}) {
    if (usarGuardado) {
      try {
        const g = JSON.parse(lembrar(ANONIMO) || "null");
        if (g && Date.now() - g.em < ANONIMO_MS) return { ok: true, compra: g.compra, pagamento: g.pagamento, precos: g.precos, moeda: g.moeda, conta: null };
      } catch (e) { /* guardado estragado: pergunta de novo */ }
    }
    const r = await fetch(API, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("estado " + r.status);
    const e = await r.json();
    guardar(ANONIMO, e.conta ? null : JSON.stringify({ em: Date.now(), compra: e.compra, pagamento: e.pagamento, precos: e.precos, moeda: e.moeda }));
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
      // a mensagem do servidor vem em portugues (ERROS em server/cloudflare/src/conta.js); a traducao fica nos textos
      if (j && typeof j.mensagem === "string") j.mensagem = t(j.mensagem);
      if (j && typeof j.ok === "boolean") return j;
      return { ok: false, mensagem: t("Algo deu errado. Tente de novo daqui a pouco.") };
    } catch (e) {
      return { ok: false, mensagem: t("Sem conexão com o servidor. Confira a internet e tente de novo.") };
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
      if (!r.ok) return mensagem(caixa, r.mensagem || t("Não deu certo. Tente de novo."), "erro");
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

  /** Para onde ir depois de entrar: a pagina que pediu o login (so do proprio site), ou o inicio.
   *  No idioma desta pagina, mesmo que a pessoa tenha trocado de idioma no meio do caminho. */
  function destino() {
    const v = lembrar(VOLTAR);
    guardar(VOLTAR, null);
    return v && DO_SITE.test(v) ? v.replace(DO_SITE, SITE) : SITE;
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
      conferir: (d) => (d.senha2 !== undefined && d.senha !== d.senha2 ? t("As duas senhas não são iguais.") : ""),
      depois: (r) => {
        if (acao === "/entrar") return voltarAoSite("");
        mostrarEnviado(form, t("Confira seu e-mail"),
          t("Mandamos um link para {email}. Abra o e-mail e clique em “Confirmar e-mail” para criar a conta.", { email: r.email }),
          t("O link vale por 48 horas. Não chegou? Confira a caixa de spam ou tente de novo daqui a alguns minutos."));
      },
    });
    // ja entrou? volta para o site
    estado().then((e) => { if (e.conta) location.replace(destino()); }).catch(() => {});
  }

  function paginaEsqueci(form) {
    ligar(form, "/esqueci", {
      depois: (r) => mostrarEnviado(form, t("Confira seu e-mail"),
        t("Se {email} tiver conta no site, mandamos para ele um link para criar uma senha nova.", { email: r.email }),
        t("O link vale por 1 hora. Não chegou? Confira a caixa de spam ou tente de novo daqui a alguns minutos.")),
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

  /** Confirmar o e-mail pede a senha da conta e um clique: programa que abre os links do e-mail para conferir nao gasta
   *  o link, e quem cadastrou o e-mail de outra pessoa nao deixa a senha dele na conta dela. */
  function paginaConfirmar(form, token) {
    if (!token) return semLink(form);
    ligar(form, "/confirmar", {
      extra: { token },
      depois: (r) => {
        if (r.tipo !== "email") return voltarAoSite(t("E-mail confirmado e conta criada. Aqui ficam suas licenças e seus dados."));
        // troca de e-mail: a pagina de entrar mostra o aviso (e, se ja entrou neste navegador, leva a aba)
        guardar(AVISO, t("E-mail trocado. Agora você entra com {email}.", { email: r.email }));
        location.assign("login");
      },
    });
  }

  function paginaRedefinir(form, token) {
    if (!token) return semLink(form);
    ligar(form, "/redefinir", {
      extra: { token },
      conferir: (d) => (d.nova !== d.nova2 ? t("As duas senhas não são iguais.") : ""),
      depois: () => voltarAoSite(t("Senha nova salva. Os outros navegadores saíram da conta.")),
    });
  }

  function semLink(form) {
    mensagem(form.querySelector(".conta-msg"), t("Esse link está incompleto. Abra de novo o link do e-mail, ou peça um novo."), "erro");
    for (const c of form.querySelectorAll("input, button")) c.disabled = true;
  }

  // ------------------------------------------------------------ compra fora do Brasil
  /** Os botoes ficam apagados e o .aviso-regiao aparece sozinho (styles.css, :has). */
  function compraIndisponivel() {
    for (const a of document.querySelectorAll("a.comprar")) {
      for (const at of ["href", "target", "rel"]) a.removeAttribute(at);
      a.setAttribute("aria-disabled", "true");
      a.setAttribute("tabindex", "-1");
      a.textContent = t("Temporariamente indisponível");
    }
  }

  // ------------------------------------------------------------ compra pelo site (Mercado Pago)
  const reais = (centavos) => (Number(centavos) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  /** Valor na moeda da compra: reais (Mercado Pago) ou dolares (Paddle, fora do Brasil). */
  const dinheiro = (centavos, moeda) => (moeda === "USD"
    ? (Number(centavos) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }) : reais(centavos));

  /** Os botoes de plano levam a pagina comprar (no lugar do e-mail), e o "Como comprar" troca de lista. */
  function compraPeloSite() {
    for (const a of document.querySelectorAll("a.comprar[data-tipo]")) {
      a.setAttribute("href", `comprar?${new URLSearchParams({ tipo: a.dataset.tipo, plano: a.dataset.plano })}`);
      a.removeAttribute("target");
      a.removeAttribute("rel");
    }
    for (const c of document.querySelectorAll(".como-email")) c.hidden = true;
    for (const c of document.querySelectorAll(".como-site")) c.hidden = false;
  }

  /** Fora do Brasil (Paddle): os precos da pagina inicial ([data-preco], [data-equiv]) viram os em dolar da API. */
  function precosEmDolar(precos) {
    let fmt;
    try { fmt = new Intl.NumberFormat(IDIOMA, { style: "currency", currency: "USD" }); } catch (e) { fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }); }
    const partes = (centavos) => {
      const p = fmt.formatToParts(Number(centavos) / 100);
      return { cur: p.filter((x) => x.type === "currency").map((x) => x.value).join(""),
        num: p.filter((x) => x.type !== "currency" && x.type !== "literal").map((x) => x.value).join("") };
    };
    for (const s of document.querySelectorAll("[data-preco]")) {
      const [tipo, plano] = s.dataset.preco.split(" ");
      const v = precos && precos[tipo] && precos[tipo][plano];
      const cur = s.querySelector(".cur");
      if (!v || !cur || !cur.nextSibling) continue;
      const { cur: simbolo, num } = partes(v);
      cur.textContent = simbolo;
      cur.nextSibling.textContent = num;
      const per = s.querySelector(".per");
      if (per && !per.dataset.imposto) {                  // a Paddle soma o imposto do pais de quem compra
        per.dataset.imposto = "1";
        per.textContent += t(" + impostos");
      }
    }
    for (const s of document.querySelectorAll("[data-equiv]")) {
      const v = precos && precos[s.dataset.equiv] && precos[s.dataset.equiv].annual;
      if (!v) continue;
      const valor = fmt.format(Math.round(v / 12) / 100);
      s.textContent = s.dataset.equiv === "floating" ? t("sai por {valor} por vaga, por mês", { valor }) : t("sai por {valor} por mês", { valor });
    }
    for (const s of document.querySelectorAll(".pag-mp")) s.hidden = true;
    for (const s of document.querySelectorAll(".pag-paddle")) s.hidden = false;
  }

  /** Copia o texto; sem permissao, deixa a chave a mostra para copiar a mao. */
  async function copiar(texto, botao) {
    try {
      await navigator.clipboard.writeText(texto);
      botao.textContent = t("Copiada");
    } catch (e) {
      botao.textContent = t("Selecione e copie");
    }
  }

  /** Endereco do pagamento: so do Mercado Pago ou da Paddle (o servidor manda, mas o script confere antes de ir). */
  function doPagamento(endereco, moeda) {
    try {
      const u = new URL(endereco);
      const host = moeda === "USD" ? /(^|\.)paddle\.(io|com)$/ : /(^|\.)mercadopago\.com(\.br)?$/;
      return u.protocol === "https:" && host.test(u.hostname);
    } catch (e) {
      return false;
    }
  }

  function paginaComprar(form) {
    const q = new URLSearchParams(location.search);
    const bloco = (id) => document.getElementById(id);
    // a volta da assinatura (renovacao automatica) traz o id dela, que o servidor pos no endereco (vale antes do resto:
    // o Mercado Pago pode juntar o external_reference); a volta da compra traz external_reference e payment_id
    // os ids sao hexadecimais; o Mercado Pago gruda "?preapproval_id=..." no fim do endereco de volta da assinatura
    const soId = (v) => ((v || "").match(/^[0-9a-f]{1,40}/) || [""])[0];
    // volta do checkout da Paddle (comprar?paddle=1): o id da assinatura ficou guardado antes de ir
    // (depois fica no endereco, para recarregar a pagina, e sai da lembranca: a proxima compra guarda a dela)
    const daPaddle = q.has("paddle");
    const assinaturaId = soId(q.get("assinatura") || (daPaddle ? lembrar(PADDLE) : ""));
    if (daPaddle) guardar(PADDLE, null);
    const compraId = assinaturaId ? "" : soId(q.get("external_reference") || q.get("compra"));
    const pagamento = (q.get("payment_id") || q.get("collection_id") || q.get("pagamento") || "").replace(/\D/g, "").slice(0, 20);
    if (assinaturaId) {
      const limpa = new URLSearchParams({ assinatura: assinaturaId });
      if (daPaddle) limpa.set("paddle", "1");
      history.replaceState(null, "", `${location.pathname}?${limpa}`);
    }
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
        entrar.textContent = String(e.conta.nome || "").trim().split(/\s+/)[0] || t("Minha conta");
        entrar.setAttribute("href", SITE);
      }
      if (compraId) return voltaDoPagamento(compraId, pagamento);
      // voltou da Paddle em outra aba (sem o id guardado): a licenca aparece na conta
      if (daPaddle && !assinaturaId) return location.replace(SITE);
      if (assinaturaId) return voltaDaAssinatura(assinaturaId, daPaddle ? "Paddle" : "Mercado Pago");
      if (!e.pagamento) {
        if (!e.compra) {
          bloco("compra-off-titulo").textContent = t("Compra temporariamente indisponível fora do Brasil");
          bloco("compra-off-texto").textContent = t("Você já pode baixar e usar grátis por 30 dias, com tudo liberado.");
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
    const moeda = e.moeda === "USD" ? "USD" : "BRL";
    // fora do Brasil (Paddle): so renovacao automatica, no cartao ou PayPal
    if (moeda === "USD") {
      marcar("automatica", "1");
      document.getElementById("compra-renovacao").hidden = true;
      document.getElementById("compra-sub").textContent = t("Pague pela Paddle, em dólar. A chave sai na hora: por e-mail e na sua conta.");
      const fino = form.querySelector(".compra-fine");
      if (fino) fino.textContent = t("Você vai para o checkout da Paddle e volta para cá depois de pagar. A renovação é automática; cancele quando quiser na sua conta. Não guardamos dados de cartão.");
    }
    let renovar = null;
    const licId = q.get("licenca");
    if (licId) {
      renovar = e.conta.licencas.find((l) => l.id === licId && l.pode_renovar) || null;
      document.getElementById("compra-titulo").textContent = t("Renovar licença");
      if (!renovar) {
        mensagem(caixa, t("Essa licença não pode ser renovada pelo site. Fale com o suporte: contato@vestroautomation.com."), "erro");
        botao.disabled = true;
        return;
      }
      const vence = renovar.situacao === "vencida" ? t("venceu em {data}", { data: dataBr(renovar.vence) }) : t("vale até {data}", { data: dataBr(renovar.vence) });
      document.getElementById("compra-sub").textContent =
        t("Chave terminada em {final}, {vence}. O período novo começa no vencimento (ou hoje, se já venceu); a chave continua a mesma.", { final: renovar.final, vence });
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
        p.textContent = `${dinheiro(v, moeda)}${NOME_PLANO[p.dataset.plano]}${tipo === "floating" ? t(" por vaga") : ""}${moeda === "USD" ? t(" + impostos") : ""}`;
      }
      document.getElementById("compra-total").textContent = ok ? dinheiro(e.precos[tipo][escolhido("plano")] * n, moeda) : "—";
      const mensal = escolhido("plano") === "monthly";
      // na Paddle o imposto do pais de quem compra vem por cima (o checkout mostra o valor final)
      document.getElementById("compra-periodo").textContent = moeda === "USD"
        ? (mensal ? t("+ impostos do seu país, por mês, até você cancelar") : t("+ impostos do seu país, por ano, até você cancelar"))
        : escolhido("automatica") === "1"
        ? (mensal ? t("por mês, no cartão, até você cancelar") : t("por ano, no cartão, até você cancelar"))
        : (mensal ? t("por 1 mês") : t("por 1 ano"));
      botao.textContent = moeda === "USD" ? t("Assinar com a Paddle")
        : escolhido("automatica") === "1" ? t("Assinar com Mercado Pago") : t("Pagar com Mercado Pago");
    }
    form.addEventListener("input", atualizar);
    atualizar();
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const n = nVagas();
      if (!Number.isInteger(n) || n < 1 || n > 50) return mensagem(caixa, t("Escolha de 1 a 50 vagas. Mais que isso: fale com a gente em contato@vestroautomation.com."), "erro");
      botao.disabled = true;
      mensagem(caixa, "", "erro");
      const r = await enviar("/comprar", { tipo: escolhido("tipo"), plano: escolhido("plano"), vagas: String(n),
        licenca: renovar ? renovar.id : "", automatica: escolhido("automatica") === "1" ? "1" : "0" });
      if (r.ok && doPagamento(r.url, moeda)) {
        if (r.assinatura) guardar(PADDLE, r.assinatura);
        return location.assign(r.url);
      }
      botao.disabled = false;
      mensagem(caixa, r.ok ? t("Algo deu errado. Tente de novo daqui a pouco.") : (r.mensagem || t("Não deu certo. Tente de novo.")), "erro");
    });
  }

  /** Volta do Mercado Pago: o servidor confere o pagamento (com o Mercado Pago) e mostra a chave. */
  function voltaDoPagamento(compraId, pagamento) {
    const caixa = document.getElementById("compra-volta");
    const titulo = document.getElementById("compra-titulo");
    const sub = document.getElementById("compra-sub");
    caixa.hidden = false;
    titulo.textContent = t("Conferindo o pagamento…");
    sub.textContent = "";
    let tentativas = 0;
    const mostrar = (h, ...partes) => caixa.replaceChildren(el("h2", {}, h), ...partes);
    const irParaConta = () => el("p", { class: "compra-acoes" }, el("a", { class: "btn btn-primary", href: SITE }, t("Ir para minha conta")));
    async function conferir() {
      const r = await enviar("/compra", { compra: compraId, pagamento });
      if (!r.ok) {
        titulo.textContent = t("Não deu para conferir agora");
        return mostrar(t("Tente de novo daqui a pouco"), el("p", {}, r.mensagem || ""),
          el("p", { class: "compra-acoes" }, el("button", { class: "btn btn-ghost", type: "button", onclick: conferir }, t("Conferir de novo"))));
      }
      if (r.situacao === "aprovada" && r.renovacao) {
        titulo.textContent = t("Licença renovada");
        return mostrar(t("Pagamento aprovado"),
          el("p", {}, t("A licença com a chave terminada em {final} agora vale até {data}. A chave continua a mesma: não precisa fazer nada no Vestro Macro.", { final: r.final, data: dataBr(r.vence) })),
          el("p", {}, t("Mandamos a confirmação para o seu e-mail.")), irParaConta());
      }
      if (r.situacao === "aprovada") {
        titulo.textContent = t("Pagamento aprovado");
        const copiarBotao = el("button", { class: "btn btn-ghost", type: "button", onclick: () => copiar(r.chave, copiarBotao) }, t("Copiar"));
        return mostrar(t("Sua chave"),
          r.chave ? el("div", { class: "compra-chave" }, el("code", {}, r.chave), copiarBotao) : null,
          el("p", {}, t("No Vestro Macro, digite essa chave onde ele pede a licença.")),
          el("p", {}, (r.vence ? t("Também mandamos a chave para o seu e-mail. Ela fica na sua conta, para copiar quando precisar, e vale até {data}.", { data: dataBr(r.vence) })
            : t("Também mandamos a chave para o seu e-mail. Ela fica na sua conta, para copiar quando precisar."))),
          irParaConta());
      }
      if (r.situacao === "pendente") {
        titulo.textContent = t("Pagamento em análise");
        const fim = ++tentativas >= 24;
        if (!fim) setTimeout(conferir, 5000);
        return mostrar(t("Aguardando o Mercado Pago"),
          el("p", {}, t("Assim que o pagamento for aprovado, a chave aparece aqui, na sua conta e no seu e-mail. Pix costuma levar alguns segundos.")),
          fim ? el("p", {}, t("Pode fechar esta página: quando aprovar, mandamos a chave por e-mail.")) : null);
      }
      if (r.situacao === "recusada") {
        titulo.textContent = t("Pagamento não aprovado");
        return mostrar(t("O Mercado Pago não aprovou o pagamento"),
          el("p", {}, t("Tente de novo, se quiser com outra forma de pagamento.")),
          el("p", { class: "compra-acoes" }, el("a", { class: "btn btn-primary", href: "comprar" }, t("Tentar de novo"))));
      }
      if (r.situacao === "devolvida") {
        titulo.textContent = t("Pagamento devolvido");
        return mostrar(t("Esse pagamento foi devolvido"), el("p", {}, r.renovacao
          ? t("O período dessa renovação saiu da licença. Dúvidas: contato@vestroautomation.com.")
          : t("A licença dessa compra foi bloqueada. Dúvidas: contato@vestroautomation.com.")), irParaConta());
      }
      titulo.textContent = t("Recebemos o pagamento");
      return mostrar(t("Precisamos conferir uma coisa"),
        el("p", {}, t("O valor pago não bateu com o pedido, então a chave não saiu sozinha. Fale com o suporte em contato@vestroautomation.com: resolvemos rápido.")));
    }
    conferir();
  }

  /** Volta do Mercado Pago (ou da Paddle) depois de assinar: espera a primeira cobranca e mostra a chave. */
  function voltaDaAssinatura(assinaturaId, provedor) {
    const caixa = document.getElementById("compra-volta");
    const titulo = document.getElementById("compra-titulo");
    document.getElementById("compra-sub").textContent = "";
    caixa.hidden = false;
    titulo.textContent = t("Conferindo a assinatura…");
    let tentativas = 0;
    const mostrar = (h, ...partes) => caixa.replaceChildren(el("h2", {}, h), ...partes);
    const irParaConta = () => el("p", { class: "compra-acoes" }, el("a", { class: "btn btn-primary", href: SITE }, t("Ir para minha conta")));
    const proxima = (r) => (r.proxima ? " " + t("A próxima cobrança é em {data}.", { data: dataBr(r.proxima) }) : "");
    const cancelarNaConta = t("Para cancelar a renovação automática, use “Cancelar renovação automática” na sua conta.");
    async function conferir() {
      const r = await enviar("/assinatura", { assinatura: assinaturaId });
      if (!r.ok) {
        titulo.textContent = t("Não deu para conferir agora");
        return mostrar(t("Tente de novo daqui a pouco"), el("p", {}, r.mensagem || ""),
          el("p", { class: "compra-acoes" }, el("button", { class: "btn btn-ghost", type: "button", onclick: conferir }, t("Conferir de novo"))));
      }
      if (r.paga && r.renovacao) {
        titulo.textContent = t("Renovação automática ligada");
        return mostrar(t("Pagamento aprovado"),
          el("p", {}, t("A licença com a chave terminada em {final} agora vale até {data}. A chave continua a mesma.", { final: r.final, data: dataBr(r.vence) }) + proxima(r)),
          el("p", {}, cancelarNaConta), irParaConta());
      }
      if (r.paga) {
        titulo.textContent = t("Renovação automática ligada");
        const copiarBotao = el("button", { class: "btn btn-ghost", type: "button", onclick: () => copiar(r.chave, copiarBotao) }, t("Copiar"));
        return mostrar(t("Sua chave"),
          r.chave ? el("div", { class: "compra-chave" }, el("code", {}, r.chave), copiarBotao) : null,
          el("p", {}, t("No Vestro Macro, digite essa chave onde ele pede a licença.")),
          el("p", {}, t("Também mandamos a chave para o seu e-mail. Ela fica na sua conta e vale até {data}.", { data: dataBr(r.vence) }) + proxima(r)),
          el("p", {}, cancelarNaConta), irParaConta());
      }
      if (r.situacao === "pendente" || r.situacao === "ativa") {
        const paddle = provedor === "Paddle";
        titulo.textContent = r.situacao === "ativa" ? t("Cartão autorizado") : (paddle ? t("Aguardando a Paddle") : t("Aguardando o Mercado Pago"));
        const fim = ++tentativas >= 24;
        if (!fim) setTimeout(conferir, 5000);
        return mostrar(t("Aguardando a primeira cobrança"),
          el("p", {}, paddle ? t("Assim que a Paddle aprovar a cobrança, a chave aparece aqui, na sua conta e no seu e-mail.")
            : t("Assim que o Mercado Pago aprovar a cobrança, a chave aparece aqui, na sua conta e no seu e-mail.")),
          fim ? el("p", {}, t("Pode fechar esta página: quando aprovar, mandamos a chave por e-mail.")) : null);
      }
      titulo.textContent = t("Assinatura não ativada");
      return mostrar(r.situacao === "pausada"
          ? (provedor === "Paddle" ? t("A assinatura está pausada na Paddle") : t("A assinatura está pausada no Mercado Pago"))
          : t("A renovação automática foi cancelada"),
        el("p", {}, provedor === "Paddle" ? t("Nada foi cobrado por esta página. Se quiser, tente de novo.")
          : t("Nada foi cobrado por esta página. Se quiser, tente de novo ou pague uma vez com Pix.")),
        el("p", { class: "compra-acoes" }, el("a", { class: "btn btn-primary", href: "comprar" }, t("Tentar de novo"))));
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

  // as mesmas opcoes de MOTIVOS_CANCELAMENTO (server/cloudflare/src/compra.js); "outro" pede o texto
  const MOTIVOS = [
    ["caro", t("Está caro")],
    ["nao_uso", t("Não estou usando o Vestro Macro")],
    ["pagar_avulso", t("Prefiro pagar quando precisar, sem cobrança automática")],
    ["faltou_recurso", t("Faltou um recurso de que eu preciso")],
    ["problema", t("Tive problemas com o programa")],
    ["outra_ferramenta", t("Vou usar outra ferramenta")],
    ["outro", t("Outro motivo")],
  ];

  /** Janela que pergunta o motivo antes de cancelar a renovacao automatica. feito() roda quando cancelou. */
  function perguntarMotivo(assinatura, feito) {
    const opcoes = MOTIVOS.map(([valor, texto]) =>
      el("label", {}, el("input", { type: "radio", name: "motivo", value: valor, required: true }), el("span", {}, el("strong", {}, texto))));
    const nota = el("textarea", { name: "nota", rows: 3, maxlength: 500, placeholder: t("Conte para a gente o motivo") });
    const campoNota = el("label", { class: "cancelar-nota", hidden: true }, el("span", {}, t("Qual é o motivo?")), nota);
    const msg = el("p", { class: "conta-msg" });
    const confirmar = el("button", { type: "submit", class: "btn btn-primary" }, t("Cancelar a renovação"));
    const voltar = el("button", { type: "button", class: "btn btn-ghost", onclick: () => janela.close() }, t("Voltar"));
    const form = el("form", { method: "dialog" },
      el("h2", { id: "cancelar-titulo" }, t("Por que você quer cancelar?")),
      el("p", {}, t("A licença continua valendo até o vencimento. Depois disso, não haverá mais cobranças.")),
      el("fieldset", { class: "escolha escolha-lista" }, el("legend", {}, t("Motivo")), opcoes),
      campoNota, msg,
      el("div", { class: "cancelar-botoes" }, voltar, confirmar));
    const janela = el("dialog", { class: "cancelar-janela", "aria-labelledby": "cancelar-titulo" }, form);
    form.addEventListener("change", () => {
      const outro = form.elements.motivo.value === "outro";
      campoNota.hidden = !outro;
      nota.required = outro;
    });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const motivo = form.elements.motivo.value;
      const texto = nota.value.trim();
      if (!motivo) return mensagem(msg, t("Escolha um motivo."), "erro");
      if (motivo === "outro" && !texto) { mensagem(msg, t("Escreva o motivo."), "erro"); return nota.focus(); }
      confirmar.disabled = voltar.disabled = true;
      const r = await enviar("/cancelar", { assinatura, motivo, nota: motivo === "outro" ? texto : "" });
      confirmar.disabled = voltar.disabled = false;
      if (!r.ok) return mensagem(msg, r.mensagem || t("Não deu certo. Tente de novo."), "erro");
      janela.close();
      feito();
    });
    janela.addEventListener("close", () => janela.remove());
    document.body.append(janela);
    janela.showModal();
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
          mostra.textContent = r.mensagem || t("Não deu certo. Tente de novo.");
        } else {
          mostra.className = "aba-chave-inteira";
          mostra.textContent = r.chave;               // a mostra tambem, se o navegador nao deixar copiar
          await copiar(r.chave, botao);
        }
        acoes.before(mostra);
      } }, t("Copiar a chave"));
      acoes.append(botao);
    }
    // renovacao automatica ligada: mostra a proxima cobranca e o botao de cancelar (abre a janela do motivo); sem ela, "Renovar"
    let auto = null;
    if (l.assinatura) {
      const a = l.assinatura;
      auto = el("p", { class: "aba-auto" }, a.situacao === "pausada"
        ? (a.provedor === "Paddle" ? t("Renovação automática pausada na Paddle") : t("Renovação automática pausada no Mercado Pago"))
        : (a.proxima ? t("Renovação automática ligada · próxima cobrança em {data}", { data: dataBr(a.proxima) }) : t("Renovação automática ligada")));
      const cancelar = el("button", { type: "button", onclick: () => perguntarMotivo(a.id, () => {
        auto.textContent = (l.vence ? t("Renovação automática cancelada: a licença vale até {data} e não haverá mais cobranças.", { data: dataBr(l.vence) })
          : t("Renovação automática cancelada: a licença vale até o vencimento e não haverá mais cobranças."));
        cancelar.remove();
        if (pagamentoLigado && l.pode_renovar) acoes.append(el("a", { class: "btn", href: `${SITE}comprar?${new URLSearchParams({ licenca: l.id })}` }, t("Renovar")));
      }) }, t("Cancelar renovação automática"));
      acoes.append(cancelar);
    } else if (pagamentoLigado && l.pode_renovar) {
      acoes.append(el("a", { class: "btn", href: `${SITE}comprar?${new URLSearchParams({ licenca: l.id })}` }, t("Renovar")));
    }
    let situacao, aviso = false;
    if (l.situacao === "bloqueada") { situacao = t("Bloqueada"); aviso = true; }
    else if (l.situacao === "vencida") { situacao = t("Vencida em {data}", { data: dataBr(l.vence) }); aviso = true; }
    else situacao = l.vence === null ? t("Ativa, sem vencimento") : t("Ativa até {data}", { data: dataBr(l.vence) });
    const tipo = l.tipo === "floating" ? (l.vagas === 1 ? t("Flutuante · {n} vaga", { n: l.vagas }) : t("Flutuante · {n} vagas", { n: l.vagas })) : TIPO.fixed;
    const onde = l.tipo === "floating"
      ? t("{uso} de {vagas} em uso agora", { uso: l.em_uso, vagas: l.vagas })
      : (l.computador ? t("No computador {nome}", { nome: l.computador }) : t("Ainda não ativada em nenhum computador"));
    const item = el("li", { class: "aba-lic" },
      el("div", { class: "aba-lic-topo" }, el("h3", {}, tipo), el("span", { class: aviso ? "aba-status aviso" : "aba-status" }, situacao)),
      el("p", { class: "aba-chave" }, t("{plano} · chave terminada em {final}", { plano: PLANO[l.plano] || l.plano, final: l.final })),
      el("p", {}, onde),
      l.motivo ? el("p", { class: "aba-auto aviso" }, l.motivo) : null,
      auto,
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
      : el("p", { class: "aba-vazio" }, t("Nenhuma licença na sua conta ainda. Recebeu a chave de outro jeito? Adicione aqui embaixo."));

    const fLicenca = el("form", { class: "aba-form", method: "post", novalidate: true },
      campo(t("Chave"), { name: "chave", required: true, maxlength: 64, placeholder: "VSTR-XXXXX-XXXXX-XXXXX-XXXXX", autocomplete: "off", spellcheck: "false" }),
      el("button", { type: "submit" }, t("Adicionar")));
    ligar(fLicenca, "/licenca", { depois: recarregar(t("Licença adicionada à sua conta.")) });

    const fDados = el("form", { class: "aba-form", method: "post", novalidate: true },
      campo(t("Nome"), { name: "nome", required: true, maxlength: 80, autocomplete: "name", value: conta.nome }),
      campo(t("E-mail"), { type: "email", name: "email", required: true, maxlength: 254, autocomplete: "email", value: conta.email }),
      campo(t("Telefone de contato"), { type: "tel", name: "telefone", maxlength: 30, autocomplete: "tel", value: conta.telefone, placeholder: "(47) 99999-9999" }),
      campo(t("Senha atual"), { type: "password", name: "senha", maxlength: 200, autocomplete: "current-password" }, t("só para trocar o e-mail")),
      el("button", { class: "aba-principal", type: "submit" }, t("Salvar")));
    ligar(fDados, "/dados", { depois: (r) => recarregar(r.email_pendente
      ? t("Dados salvos. Mandamos um link para {email}: o e-mail da conta muda quando você abrir esse link.", { email: r.email_pendente })
      : t("Dados salvos."))() });

    const fSenha = el("form", { class: "aba-form", method: "post", novalidate: true },
      campo(t("Senha atual"), { type: "password", name: "senha", required: true, maxlength: 200, autocomplete: "current-password" }),
      campo(t("Senha nova"), { type: "password", name: "nova", required: true, minlength: 8, maxlength: 200, autocomplete: "new-password" }),
      campo(t("Repita a senha nova"), { type: "password", name: "nova2", required: true, minlength: 8, maxlength: 200, autocomplete: "new-password" }),
      el("button", { type: "submit" }, t("Trocar a senha")));
    ligar(fSenha, "/senha", {
      conferir: (d) => (d.nova !== d.nova2 ? t("As duas senhas novas não são iguais.") : ""),
      depois: recarregar(t("Senha trocada. Os outros navegadores saíram da conta.")),
    });

    const sair = el("button", { class: "aba-sair", type: "button", onclick: async () => {
      await enviar("/sair", {});
      guardar(RECOLHIDA, null);
      guardar(ANONIMO, null);
      location.assign(SITE);
    } }, t("Sair da conta"));

    const msg = el("p", { class: "conta-msg ok" });
    if (aviso) mensagem(msg, aviso, "ok");

    const iniciais = String(conta.nome || "").trim().split(/\s+/).slice(0, 2).map((p) => Array.from(p)[0] || "").join("").toUpperCase();
    // cabeca (titulo, X e quem entrou) fica parada; so o corpo rola, passando por baixo dela
    const aba = el("aside", { class: "aba-conta", id: "minha-conta", "aria-label": t("Minha conta") },
      el("div", { class: "aba-cabeca" },
      el("div", { class: "aba-topo" },
        el("span", {}, t("Minha conta")),
        el("button", { class: "aba-fechar", type: "button", title: t("Recolher a aba"), "aria-label": t("Recolher a aba"),
          onclick: () => abrirAba(false) }, "×")),
      el("div", { class: "aba-perfil" },
        el("span", { class: "aba-avatar", "aria-hidden": "true" }, iniciais || "?"),
        el("div", {}, el("strong", {}, conta.nome), el("small", {}, conta.email)))),
      el("div", { class: "aba-corpo" },
      msg,
      el("h2", {}, t("Licenças")), lista,
      el("details", { class: "aba-mais" }, el("summary", {}, t("Adicionar uma licença pela chave")), fLicenca),
      el("h2", {}, t("Meus dados")), fDados,
      el("details", { class: "aba-mais" }, el("summary", {}, t("Trocar a senha")), fSenha),
      sair));

    const antiga = document.getElementById("minha-conta");
    if (antiga) antiga.replaceWith(aba);
    else document.body.prepend(aba);

    // topo: "Entrar" vira o nome de quem entrou, e abre/fecha a aba
    const primeiro = String(conta.nome || "").trim().split(/\s+/)[0] || t("Minha conta");
    const botao = el("button", { class: "conta-botao", type: "button", "aria-controls": "minha-conta",
      onclick: () => abrirAba(!document.body.classList.contains("aba-aberta")) }, el("span", {}, primeiro));
    const atual = document.querySelector("a.conta-entrar, button.conta-botao");
    if (atual) atual.replaceWith(botao);

    document.body.classList.add("com-conta");
    const aberta = Boolean(aviso) || document.body.classList.contains("aba-aberta") ||
      (window.matchMedia(LARGA).matches && !lembrar(RECOLHIDA));
    abrirAba(aberta);
  }

  // ------------------------------------------------------------ botao de idioma (topo)
  /** O <details class="idioma"> abre sozinho; aqui so fecha ao clicar fora ou com Esc. */
  function menuIdioma() {
    const menu = document.querySelector("details.idioma");
    if (!menu) return;
    document.addEventListener("click", (ev) => { if (menu.open && !menu.contains(ev.target)) menu.open = false; });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && menu.open) { menu.open = false; menu.querySelector("summary").focus(); }
    });
  }

  // ------------------------------------------------------------ inicio
  function iniciar() {
    menuIdioma();
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
      if (e.moeda === "USD" && e.precos) precosEmDolar(e.precos);
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
