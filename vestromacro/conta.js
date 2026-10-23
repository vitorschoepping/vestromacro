/* conta.js — area do cliente no site: botao Entrar, aba lateral de quem entrou e compra fora do Brasil;
   paginas de entrar, criar conta, confirmar o e-mail e criar senha nova (links do e-mail).

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
        if (g && Date.now() - g.em < ANONIMO_MS) return { ok: true, compra: g.compra, conta: null };
      } catch (e) { /* guardado estragado: pergunta de novo */ }
    }
    const r = await fetch(API, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("estado " + r.status);
    const e = await r.json();
    guardar(ANONIMO, e.conta ? null : JSON.stringify({ em: Date.now(), compra: e.compra }));
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
    location.assign(SITE);
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
    estado().then((e) => { if (e.conta) location.replace(SITE); }).catch(() => {});
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

  // ------------------------------------------------------------ aba lateral
  let campos = 0;
  /** Campo como nas paginas de entrar: div.campo com o rotulo ligado ao input pelo id. */
  function campo(rotulo, attrs, dica) {
    const id = `aba-campo-${++campos}`;
    return el("div", { class: "campo" }, el("label", { for: id }, rotulo), el("input", { ...attrs, id }), dica ? el("small", {}, dica) : null);
  }

  function licencaItem(l) {
    let situacao, aviso = false;
    if (l.situacao === "bloqueada") { situacao = "Bloqueada"; aviso = true; }
    else if (l.situacao === "vencida") { situacao = `Vencida em ${dataBr(l.vence)}`; aviso = true; }
    else situacao = l.vence === null ? "Ativa, sem vencimento" : `Ativa até ${dataBr(l.vence)}`;
    const tipo = l.tipo === "floating" ? `Flutuante · ${l.vagas} ${l.vagas === 1 ? "vaga" : "vagas"}` : TIPO.fixed;
    const onde = l.tipo === "floating"
      ? `${l.em_uso} de ${l.vagas} em uso agora`
      : (l.computador ? `No computador ${l.computador}` : "Ainda não ativada em nenhum computador");
    return el("li", { class: "aba-lic" },
      el("div", { class: "aba-lic-topo" }, el("h3", {}, tipo), el("span", { class: aviso ? "aba-status aviso" : "aba-status" }, situacao)),
      el("p", { class: "aba-chave" }, `${PLANO[l.plano] || l.plano} · chave terminada em ${l.final}`),
      el("p", {}, onde));
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
    estado({ usarGuardado: true }).then((e) => {
      if (!e.compra) compraIndisponivel();
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
