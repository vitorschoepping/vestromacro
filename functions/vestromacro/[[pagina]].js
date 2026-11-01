/*
Pages Function: quem abre o site sem o idioma no endereco (/vestromacro/, /vestromacro/login, links antigos,
links dos e-mails, volta do Mercado Pago) vai para a mesma pagina no idioma do pais de onde vem o acesso:
/pt-br/vestromacro/..., /en/..., /es/... ou /zh-cn/... (as paginas sao geradas por tools/site_idiomas.py).

O pais vem da Cloudflare (request.cf.country, pelo IP), sem guardar nada. Sem pais (rede anonima, teste local),
vale o idioma do navegador (Accept-Language); sem nada disso, portugues. O endereco mantem a consulta (?...);
o # (os links do e-mail) o navegador mantem sozinho no redirecionamento.

So roda nos enderecos do _routes.json (gerado pelo tools/publicar_site.py): raiz e paginas sem idioma.
A API (/vestromacro/api/*) tem a Function propria, mais especifica. Imagens, .css e .js vao direto para os arquivos.
*/

export const IDIOMAS = ["pt-br", "en", "es", "zh-cn"];
const PAISES = {
  "pt-br": ["BR", "PT", "AO", "MZ", "CV", "GW", "ST", "TL"],
  es: ["ES", "MX", "AR", "CO", "CL", "PE", "VE", "EC", "GT", "CU", "BO", "DO", "HN", "PY", "SV", "NI", "CR", "PA", "UY", "PR", "GQ"],
  "zh-cn": ["CN", "TW", "HK", "MO", "SG"],
};
const POR_PAIS = new Map(Object.entries(PAISES).flatMap(([idioma, paises]) => paises.map((p) => [p, idioma])));
// paises que a Cloudflare usa quando nao sabe: XX (desconhecido) e T1 (Tor)
const SEM_PAIS = new Set(["", "XX", "T1"]);

/** Idioma do site para o pais (codigo de 2 letras) e, sem pais, para o Accept-Language do navegador. */
export function idiomaDoAcesso(pais, aceita) {
  pais = String(pais || "").toUpperCase();
  if (!SEM_PAIS.has(pais)) return POR_PAIS.get(pais) || "en";
  for (const parte of String(aceita || "").toLowerCase().split(",")) {
    const lingua = parte.split(";")[0].trim().split("-")[0];
    if (lingua === "pt") return "pt-br";
    if (lingua === "es") return "es";
    if (lingua === "zh") return "zh-cn";
    if (lingua === "en") return "en";
  }
  return "pt-br";
}

/** /vestromacro/login.html -> "login"; /vestromacro/ e /index.html -> ""; outra coisa (arquivo, subpasta) -> null. */
export function paginaDe(caminho) {
  if (caminho === "/") return "";
  const m = /^\/vestromacro(?:\/([A-Za-z0-9_-]*?)(?:\.html)?)?$/.exec(caminho);
  if (!m) return null;
  const nome = m[1] || "";
  return nome === "index" ? "" : nome;
}

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  const pagina = paginaDe(url.pathname);
  if (pagina === null || !["GET", "HEAD"].includes(request.method)) return next();
  // o pais como o servidor le (paisDe em server/cloudflare/src/conta.js): request.cf e, sem ele, o cabecalho
  const pais = (request.cf && request.cf.country) || request.headers.get("cf-ipcountry");
  const idioma = idiomaDoAcesso(pais, request.headers.get("accept-language"));
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/${idioma}/vestromacro/${pagina}${url.search}`,
      // depende do pais de quem pede: nenhum cache guarda
      "Cache-Control": "private, no-store",
    },
  });
}
