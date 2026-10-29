// malha.js: fundo animado do site. Pontos de luz azuis e roxos discretos andam devagar e piscam;
// quando duas ficam perto, aparece uma linha entre elas. Canvas fixo atras da pagina.
// A luz e as bolinhas desfocadas sao desenhadas uma vez em canvas pequenos (sprites) e so copiadas a cada quadro.
// Para quando a aba fica escondida ou a tela e estreita (o canvas some); com "reduzir movimento" do Windows desenha um quadro parado.
(function () {
  "use strict";
  const canvas = document.createElement("canvas");
  canvas.className = "malha";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");
  const parado = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const CORES = [[61, 155, 255], [61, 155, 255], [110, 166, 255], [124, 92, 255]]; // azul do logo e roxo do modo avancado
  const DIST = 160;
  const INTENSIDADE = 1.82, LINHAS = 2.21; // forca da luz e das linhas (escolhidas pelo Vitor em 2026-10-29: 1,4 e 1,7, depois +30%)
  let largura = 0, altura = 0, pontos = [], fundo = [], quadro = 0;

  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const mistura = (c, alvo, t) => c.map((v, i) => Math.round(v + (alvo[i] - v) * t));

  function sprite(tam, desenho) {
    const s = document.createElement("canvas");
    s.width = s.height = tam;
    desenho(s.getContext("2d"), tam);
    return s;
  }
  // luz em volta: queda em 1/x (forte no centro, cai rapido e vira uma cauda longa e fraca, como luz de verdade);
  // a curva e descontada para chegar a zero na borda do sprite, sem borda redonda marcada
  function luz(c) {
    return sprite(128, (g, t) => {
      const m = t / 2, K = 14, piso = 1 / (K + 1);
      const gr = g.createRadialGradient(m, m, 0, m, m, m);
      for (let i = 0; i <= 24; i++) {
        const x = i / 24;
        gr.addColorStop(x, rgba(c, ((1 / (x * K + 1) - piso) / (1 - piso)).toFixed(4)));
      }
      g.fillStyle = gr; g.fillRect(0, 0, t, t);
    });
  }
  // bolinhas grandes do fundo, fora de foco
  function bokeh(c) {
    return sprite(128, (g, t) => {
      const m = t / 2;
      g.filter = "blur(10px)";
      const gr = g.createRadialGradient(m, m, 0, m, m, m - 22);
      [[0, .9], [.5, .7], [.8, .35], [1, 0]].forEach(([p, a]) => gr.addColorStop(p, rgba(c, a)));
      g.fillStyle = gr; g.fillRect(0, 0, t, t);
    });
  }
  const SPR = CORES.map((c) => ({ luz: luz(c), bokeh: bokeh(c) }));

  function criar() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    largura = innerWidth; altura = innerHeight;
    canvas.width = largura * dpr; canvas.height = altura * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(190, Math.max(50, largura * altura / 6000)));
    pontos = Array.from({ length: n }, () => {
      const k = Math.floor(Math.random() * CORES.length);
      const perto = Math.random(); // profundidade: as de perto sao maiores e mais rapidas
      return {
        x: Math.random() * largura, y: Math.random() * altura,
        vx: (Math.random() - .5) * (.12 + perto * .2), vy: (Math.random() - .5) * (.12 + perto * .2),
        r: 1.2 + perto * 2.6, perto, cor: CORES[k], viva: mistura(CORES[k], [200, 230, 255], .3), spr: SPR[k],
        fase: Math.random() * Math.PI * 2, ritmo: .005 + Math.random() * .016
      };
    });
    fundo = Array.from({ length: 18 }, () => {
      const k = Math.floor(Math.random() * CORES.length);
      return {
        x: Math.random() * largura, y: Math.random() * altura,
        r: 18 + Math.random() * 55, a: .025 + Math.random() * .045,
        vx: (Math.random() - .5) * .07, vy: (Math.random() - .5) * .07, spr: SPR[k]
      };
    });
  }

  function mover(p, margem) {
    p.x += p.vx; p.y += p.vy;
    if (p.x < -margem) p.x = largura + margem; else if (p.x > largura + margem) p.x = -margem;
    if (p.y < -margem) p.y = altura + margem; else if (p.y > altura + margem) p.y = -margem;
  }

  // rolagem com profundidade: a malha anda mais devagar que a pagina (as de perto um pouco mais rapido)
  // e chega atrasada, com inercia, em vez de grudar na rolagem
  let rolagem = scrollY;
  const tela = (v, max) => ((v % max) + max) % max;

  function desenhar() {
    rolagem += (scrollY - rolagem) * .06;
    ctx.clearRect(0, 0, largura, altura);
    for (const b of fundo) {
      if (!parado) mover(b, b.r * 2);
      const h = altura + b.r * 4;
      b.sy = tela(b.y - rolagem * .06 + b.r * 2, h) - b.r * 2;
      ctx.globalAlpha = b.a;
      ctx.drawImage(b.spr.bokeh, b.x - b.r * 2, b.sy - b.r * 2, b.r * 4, b.r * 4);
    }
    for (const p of pontos) {
      if (!parado) { mover(p, 20); p.fase += p.ritmo; }
      p.brilho = .3 + .7 * Math.pow((Math.sin(p.fase) + 1) / 2, 3); // pisca devagar, de vez em quando
      p.sy = tela(p.y - rolagem * (.12 + .28 * p.perto) + 20, altura + 40) - 20;
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = .9;
    ctx.globalCompositeOperation = "lighter"; // linhas e luz somadas: onde cruzam, acendem
    for (let i = 0; i < pontos.length; i++) {
      const a = pontos[i];
      for (let j = i + 1; j < pontos.length; j++) {
        const b = pontos[j], dx = a.x - b.x, dy = a.sy - b.sy, d2 = dx * dx + dy * dy;
        if (d2 > DIST * DIST) continue;
        const forca = 1 - Math.sqrt(d2) / DIST;
        ctx.strokeStyle = rgba(a.viva, Math.min(1, (forca * .6 * Math.min(a.brilho, b.brilho) + forca * .1) * LINHAS).toFixed(3));
        ctx.beginPath(); ctx.moveTo(a.x, a.sy); ctx.lineTo(b.x, b.sy); ctx.stroke();
      }
    }
    // cada ponto e so luz, sem bolinha solida no meio: a intensidade multiplica a curva 1/x inteira,
    // entao o centro sobe muito e a periferia quase nao muda; acima de 1 soma outra camada
    for (const p of pontos) {
      const l = p.r * (6 + 14 * p.brilho);
      for (let a = (.15 + .85 * p.brilho) * INTENSIDADE * 1.5; a > .01; a -= 1) {
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(p.spr.luz, p.x - l, p.sy - l, l * 2, l * 2);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  // na tela estreita o CSS esconde o canvas: ai nem desenha, para nao gastar bateria a toa
  const estreita = matchMedia("(max-width: 900px)");
  function laco() { desenhar(); quadro = requestAnimationFrame(laco); }
  function ligar() {
    cancelAnimationFrame(quadro);
    if (estreita.matches || document.hidden) return;
    if (largura !== innerWidth || altura !== innerHeight) criar(); // so recria os pontos se o tamanho mudou
    if (parado) desenhar(); else laco();
  }

  ligar();
  let espera;
  addEventListener("resize", () => { clearTimeout(espera); espera = setTimeout(ligar, 150); });
  estreita.addEventListener("change", ligar);
  document.addEventListener("visibilitychange", ligar);
})();
